export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot bodies contain long changelog lines.
  ignores: [(message) => message.includes('dependabot[bot]')],
};
