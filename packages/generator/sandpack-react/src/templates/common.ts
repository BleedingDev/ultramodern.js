export const commonFiles = {
  ".codesandbox/tasks.json": "{\n  \"$schema\": \"https://codesandbox.io/schemas/tasks.json\",\n  \"setupTasks\": [\n    {\n      \"name\": \"Installing Dependencies\",\n      \"command\": \"pnpm install\"\n    }\n  ],\n  \"tasks\": {\n    \"start\": {\n      \"name\": \"Application\",\n      \"command\": \"pnpm run start\",\n      \"runAtStart\": true,\n      \"restartOn\": {\n        \"files\": [\"pnpm-lock.yaml\"]\n      }\n    }\n  }\n}\n",
  ".codesandbox/environment.json": "{\n  \"nodeVersion\": 18\n}\n",
  ".gitignore": ".DS_Store\n\n.pnp\n.pnp.js\n.env.local\n.env.*.local\n.history\n*.log*\n\nnode_modules/\n.yarn-integrity\n.pnpm-store/\n*.tsbuildinfo\n.eslintcache\n.changeset/pre.json\n\ndist/\ncoverage/\nrelease/\noutput/\noutput_resource/\nlog/\n\n.vscode/**/*\n!.vscode/settings.json\n!.vscode/extensions.json\n.idea/\n\n**/*/typings/auto-generated\n\nmodern.config.local.*\n",
  ".npmrc": "strict-peer-dependencies=false\n"
};