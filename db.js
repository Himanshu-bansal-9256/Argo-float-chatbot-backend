import pg from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

// Check if the database URL is provided in the environment variables
if (!process.env.DATABASE_URL) {
  throw new Error("FATAL ERROR: DATABASE_URL is not set in the .env file.");
}

// --- START: MODIFIED CODE ---

// Base configuration object
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
};

// Conditionally add the SSL configuration ONLY in a production environment
if (process.env.NODE_ENV === 'production') {
  console.log("Production environment detected, enabling SSL for database connection.");
  dbConfig.ssl = {
    rejectUnauthorized: false
  };
}

// Create a new pool instance using the conditionally configured object.
const pool = new pg.Pool(dbConfig);

// --- END: MODIFIED CODE ---


// Optional: Log a success message when the connection is established.
pool.on('connect', () => {
  console.log('Successfully connected to the PostgreSQL database!');
});

export default pool;