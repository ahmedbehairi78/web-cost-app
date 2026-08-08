import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { env } from '../env.js';
import { pgConnectionOptions } from '../pgConnection.js';

const PgSession = connectPgSimple(session);
const pool = new Pool(pgConnectionOptions(env.databaseUrl));

export const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  name: 'web_cost_sid',
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: env.sessionCookieSameSite,
    secure: env.nodeEnv === 'production',
    maxAge: 1000 * 60 * 60 * 10,
  },
});

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}
