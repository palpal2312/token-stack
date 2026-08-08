const { execSync } = require('child_process');
try {
  execSync('npx next build', { stdio: 'inherit' });
} catch (e) {
  console.log('Build failed');
}
