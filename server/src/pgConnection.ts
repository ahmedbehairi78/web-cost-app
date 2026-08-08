/** Shared pg Pool / Prisma adapter options (Railway Postgres uses SSL). */
export function pgConnectionOptions(connectionString: string) {
  const needsSsl =
    process.env.PGSSLMODE === 'require' ||
    /sslmode=require/i.test(connectionString) ||
    /\.railway\.(app|internal)/i.test(connectionString);

  if (!needsSsl) {
    return { connectionString };
  }

  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
  };
}
