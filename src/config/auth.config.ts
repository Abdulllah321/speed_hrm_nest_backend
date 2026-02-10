export default {
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET ||
      'your-super-secret-access-key-change-in-production',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      'your-super-secret-refresh-key-change-in-production',
    accessExpiresIn: '7d', // 7 days - suitable for portal applications
    refreshExpiresIn: '30d', // 30 days - backup for extended sessions
    issuer: 'speed-limit-app',
  },
  password: {
    minLength: 8,
    saltRounds: 12,
  },
  security: {
    sessionTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days to match access token - sliding session
  },
};
