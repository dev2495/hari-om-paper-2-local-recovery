SELECT 'CREATE DATABASE authdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'authdb')\gexec

SELECT 'CREATE DATABASE masterdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'masterdb')\gexec

SELECT 'CREATE DATABASE specdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'specdb')\gexec

SELECT 'CREATE DATABASE salesdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'salesdb')\gexec

SELECT 'CREATE DATABASE productiondb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'productiondb')\gexec

SELECT 'CREATE DATABASE inventorydb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inventorydb')\gexec

SELECT 'CREATE DATABASE analyticsdb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'analyticsdb')\gexec

