/** Command names only, so the entry point can route without loading what the commands need. */
export const developerCommands = ['login', 'onboard', 'new', 'whoami', 'logout', 'setup', 'dev', 'doctor', 'guide', 'context'];
export const backendCommands = ['projects', 'lines', 'bindings', 'enroll', 'activate', 'drain', 'revoke'];
export const operatorCommands = ['init', 'check', 'status', 'run', 'byor', 'create-room', ...backendCommands];
