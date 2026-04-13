-- Create databases
CREATE DATABASE masterdb;
CREATE DATABASE specdb;
CREATE DATABASE specsdb;
CREATE DATABASE productiondb;
CREATE DATABASE inventorydb;
CREATE DATABASE analyticsdb;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE masterdb TO "user";
GRANT ALL PRIVILEGES ON DATABASE specdb TO "user";
GRANT ALL PRIVILEGES ON DATABASE salesdb TO "user";
GRANT ALL PRIVILEGES ON DATABASE productiondb TO "user";
GRANT ALL PRIVILEGES ON DATABASE inventorydb TO "user";
GRANT ALL PRIVILEGES ON DATABASE analyticsdb TO "user";

-- Exit psql
\q
