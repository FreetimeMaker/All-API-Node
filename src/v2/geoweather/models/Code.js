const { Client, TablesDB, Query } = require('node-appwrite');

const DATABASE_ID = process.env.APPWRITE_GEOWEATHER_DATABASE_ID || 'geoweather';
const TABLE = process.env.APPWRITE_GEOWEATHER_CODES_TABLE_ID || 'geoweather_codes';

function getTablesDB() {
    const endpoint = process.env.APPWRITE_ENDPOINT;
    const projectId = process.env.APPWRITE_GEOWEATHER_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;
    const apiKey = process.env.APPWRITE_GEOWEATHER_API_KEY || process.env.APPWRITE_API_KEY;

    if (!endpoint || !projectId || !apiKey) {
        throw new Error('Appwrite GeoWeather configuration is missing');
    }

    const client = new Client()
        .setEndpoint(endpoint)
        .setProject(projectId)
        .setKey(apiKey);

    return new TablesDB(client);
}

function normalizeRow(row) {
    if (!row) return row;
    return { ...row, id: row.id || row.$id };
}

const Code = {
    getClient() {
        return getTablesDB();
    },

    async findByCode(code) {
        const db = this.getClient();
        const result = await db.listRows({
            databaseId: DATABASE_ID,
            tableId: TABLE,
            queries: [
                Query.equal('code', String(code).trim().toUpperCase()),
                Query.limit(1),
            ],
        });

        const row = result.rows[0];
        if (!row) throw new Error('Code not found');
        return normalizeRow(row);
    },

    async redeem(code, userId) {
        const existing = await this.findByCode(code);
        if (existing.is_used) throw new Error('Code already used');
        return { code: existing, type: existing.type };
    },

    async markAsUsed(codeId, userId) {
        const db = this.getClient();
        const row = await db.updateRow({
            databaseId: DATABASE_ID,
            tableId: TABLE,
            rowId: codeId,
            data: {
                is_used: true,
                used_by: userId,
                used_at: new Date().toISOString(),
            },
        });
        return normalizeRow(row);
    },

    async isCodeValid(code) {
        try {
            const existing = await this.findByCode(code);
            return !existing.is_used;
        } catch {
            return false;
        }
    },
};

module.exports = Code;
