const nextJest = require('next/jest');
module.exports = nextJest({ dir: './' })({
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  clearMocks: true,
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
});
