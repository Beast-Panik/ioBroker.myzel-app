import { expect } from 'chai';
import type net from 'node:net';
import type os from 'node:os';
import { Heimnetz, alsAdresse, automatischeAdressen, imHeimnetz, normalisiere } from './heimnetz';

const schnittstelle = (address: string, internal = false): os.NetworkInterfaceInfo =>
    ({
        address,
        family: address.includes(':') ? 'IPv6' : 'IPv4',
        internal,
        netmask: '',
        mac: '',
        cidr: null,
    }) as os.NetworkInterfaceInfo;

describe('Heimnetz', () => {
    it('findet private Adressen und lässt Schleife, Docker und Brücken aus', () => {
        const adressen = automatischeAdressen(8095, {
            lo: [schnittstelle('127.0.0.1', true), schnittstelle('::1', true)],
            eth0: [
                schnittstelle('192.168.178.20'),
                schnittstelle('fd00::20'),
                schnittstelle('fe80::1'),
                schnittstelle('2a02:810::20'),
            ],
            wlan0: [schnittstelle('10.0.0.7'), schnittstelle('100.64.0.1')],
            docker0: [schnittstelle('172.17.0.1')],
            'br-1234': [schnittstelle('172.18.0.1')],
            veth99: [schnittstelle('172.19.0.1')],
            virbr0: [schnittstelle('192.168.122.1')],
            eth1: [schnittstelle('172.16.5.5'), schnittstelle('172.32.0.1'), schnittstelle('169.254.1.1')],
        });
        expect(adressen).to.deep.equal(['192.168.178.20:8095', '10.0.0.7:8095', '172.16.5.5:8095', '[fd00::20]:8095']);
    });

    it('liefert höchstens vier Adressen', () => {
        const viele = { eth0: [1, 2, 3, 4, 5].map(i => schnittstelle(`192.168.1.${i}`)) };
        expect(automatischeAdressen(1, viele)).to.have.length(4);
    });

    it('schreibt Adressen einheitlich', () => {
        expect(normalisiere('::ffff:192.168.1.5')).to.equal('192.168.1.5');
        expect(normalisiere('::ffff:abcd')).to.equal('::ffff:abcd');
        expect(normalisiere('fd00::1')).to.equal('fd00::1');
        expect(alsAdresse('fd00::1', 8095)).to.equal('[fd00::1]:8095');
        expect(alsAdresse('192.168.1.5', 8095)).to.equal('192.168.1.5:8095');
    });

    const eigene = (): NodeJS.Dict<os.NetworkInterfaceInfo[]> => ({
        eth0: [
            { ...schnittstelle('2001:db8:1:2::20'), cidr: '2001:db8:1:2::20/64' },
            { ...schnittstelle('203.0.113.20'), cidr: '203.0.113.20/28' },
        ],
    });

    for (const [adresse, erwartet] of [
        ['192.168.1.5', true],
        ['10.1.2.3', true],
        ['172.31.255.1', true],
        ['127.0.0.1', true],
        ['169.254.3.4', true],
        ['fd12:3456::1', true],
        ['fe80::1%eth0', true],
        ['::1', true],
        ['2001:db8:1:2:abcd::9', true],
        ['203.0.113.30', true],
        ['203.0.113.40', false],
        ['172.32.0.1', false],
        ['100.64.0.1', false],
        ['8.8.8.8', false],
        ['2001:db8:1:3::9', false],
        ['kein Ort', false],
    ] as const) {
        it(`im Heimnetz: ${adresse} ${erwartet ? 'ja' : 'nein'}`, () => {
            expect(imHeimnetz(adresse, eigene)).to.equal(erwartet);
        });
    }

    it('weist Verbindungen von außerhalb ab, gewarnt wird nur beim ersten Mal', () => {
        const log: string[] = [];
        const genommen: string[] = [];
        const heimnetz = new Heimnetz({
            port: 0,
            nimm: (_strom, herkunft) => genommen.push(herkunft.adresse),
            log: {
                debug: t => log.push(`debug ${t}`),
                info: () => undefined,
                warn: t => log.push(`warn ${t}`),
                error: () => undefined,
            },
            zustand: () => undefined,
            schnittstellen: eigene,
        });
        const zerstoert: string[] = [];
        const socket = (remoteAddress: string): net.Socket =>
            ({
                remoteAddress,
                setNoDelay: () => undefined,
                destroy: () => zerstoert.push(remoteAddress),
            }) as unknown as net.Socket;
        const nimm = (heimnetz as unknown as { angenommen(s: net.Socket): void }).angenommen.bind(heimnetz);
        nimm(socket('8.8.8.8'));
        nimm(socket('::ffff:9.9.9.9'));
        nimm(socket('::ffff:192.168.1.5'));
        expect(zerstoert).to.deep.equal(['8.8.8.8', '::ffff:9.9.9.9']);
        expect(genommen).to.deep.equal(['192.168.1.5']);
        expect(log).to.deep.equal([
            'warn Verbindung von 8.8.8.8 abgewiesen: nicht aus dem Heimnetz. Weitere nur im Debug-Log.',
            'debug Verbindung von 9.9.9.9 abgewiesen: nicht aus dem Heimnetz',
        ]);
    });
});
