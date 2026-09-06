-- Runs only for a new PostgreSQL data volume. Existing databases require operator preparation.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
