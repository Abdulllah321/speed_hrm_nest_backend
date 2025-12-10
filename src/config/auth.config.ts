export default {
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'your-super-secret-access-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production',
    accessExpiresIn: '2h',
    refreshExpiresIn: '7d',
    issuer: 'speed-limit-app',
  },
  password: {
    minLength: 8,
    saltRounds: 12,
  },
  security: {
    sessionTimeout: 24 * 60 * 60 * 1000,
  },
};
