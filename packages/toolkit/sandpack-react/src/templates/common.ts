export const commonFiles = {
  ".codesandbox/environment.json": "{\n  \"nodeVersion\": 18\n}\n",
  ".codesandbox/tasks.json": "{\n  \"$schema\": \"https://codesandbox.io/schemas/tasks.json\",\n  \"setupTasks\": [\n    {\n      \"name\": \"Installing Dependencies\",\n      \"command\": \"pnpm install\"\n    }\n  ],\n  \"tasks\": {\n    \"start\": {\n      \"name\": \"Application\",\n      \"command\": \"pnpm run start\",\n      \"runAtStart\": true,\n      \"restartOn\": {\n        \"files\": [\"pnpm-lock.yaml\"]\n      }\n    }\n  }\n}\n"
};