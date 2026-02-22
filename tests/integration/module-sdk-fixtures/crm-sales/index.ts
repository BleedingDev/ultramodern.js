export const registerRoutes = () => {
  return 'crm-routes-registered';
};

export const registerCapabilities = () => {
  return ['crm:deals:read', 'crm:deals:write'];
};

export const registerMigrations = () => {
  return ['crm-sales-v1'];
};
