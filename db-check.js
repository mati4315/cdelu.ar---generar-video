const mysql = require('mysql2/promise');

async function checkTheme() {
    try {
        const connection = await mysql.createConnection({
            host: '193.203.175.35', // or 'srv1183.hstgr.io'
            user: 'u692901087_matias',
            password: 'Mati4315.',
            database: 'u692901087_wp2',
        });
        
        console.log('Connected to MySQL!');
        // WP options table is usually wp_options but it might have a prefix.
        // We can query SHOW TABLES to find the options table.
        const [tables] = await connection.query('SHOW TABLES LIKE "%options"');
        if (tables.length === 0) {
            console.log('No options table found.');
            await connection.end();
            return;
        }
        
        const tableName = Object.values(tables[0])[0];
        console.log(`Using options table: ${tableName}`);
        
        const [rows] = await connection.query(`SELECT option_value FROM ${tableName} WHERE option_name = "stylesheet" OR option_name = "template"`);
        console.log('Active theme is likely one of:', rows.map(r => r.option_value));
        
        await connection.end();
    } catch (err) {
        console.error('Database connection failed:', err);
    }
}

checkTheme();
