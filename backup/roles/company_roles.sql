--
-- PostgreSQL database cluster dump
--

\restrict ojlYljZFIg1dEjcI4fxeWcwAFkccbYsqfgEhkQQyUFf3ScGFKFFl1LnjKcdOrvU

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE speedlimit;
ALTER ROLE speedlimit WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:0OrXNQGVLfOcRl6Y74Vylw==$zhE0bScjUDyPrvlFalpz6apVTaPKzM6nmkNxjamlJe0=:AeDj7du1O3JNGDNFhdA5en9l2/4DyBDwfNl66hfvfXY=';
CREATE ROLE user_speed_sport_mkzblxzh;
ALTER ROLE user_speed_sport_mkzblxzh WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:kd/STQT50ZAsFwQqHnmJ0A==$cOrBuB6J1XDabnk0l1N/cbCREmlZydFcx7FhB5vCOrI=:XOI2/0wYANkvoQWvua4Cx857Bj8TW/mD2fXDZvMMufA=';

--
-- User Configurations
--






\unrestrict ojlYljZFIg1dEjcI4fxeWcwAFkccbYsqfgEhkQQyUFf3ScGFKFFl1LnjKcdOrvU

--
-- PostgreSQL database cluster dump complete
--

