export default {
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'your-super-secret-access-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key-change-in-production',
    accessExpiresIn: '7d', // Short-lived for security
    refreshExpiresIn: '30d', // 30 days - allows users to stay logged in for a month
    issuer: 'speed-limit-app',
  },
  password: {
    minLength: 8,
    saltRounds: 12,
  },
  security: {
    sessionTimeout: 30 * 24 * 60 * 60 * 1000, // 30 days to match refresh token - sliding session
  },
};
