import gemeinsam from '../protokoll/v1/gemeinsam.schema.json';
import { erstellePruefer } from './basis/schema';

const schema = {
    type: 'object',
    required: ['port', 'adressen', 'nachlaufMin', 'hinweisFristMin', 'textLaenge'],
    properties: {
        port: { type: 'integer', minimum: 1024, maximum: 65535 },
        adressen: {
            type: 'array',
            maxItems: 4,
            uniqueItems: true,
            items: { $ref: `${gemeinsam.$id}#/$defs/adresse` },
        },
        nachlaufMin: { type: 'integer', minimum: 1, maximum: 120 },
        hinweisFristMin: { type: 'integer', minimum: 1, maximum: 1440 },
        textLaenge: { type: 'integer', minimum: 100, maximum: 4000 },
    },
};

export const pruefeEinstellungen = erstellePruefer(schema, [gemeinsam]);
