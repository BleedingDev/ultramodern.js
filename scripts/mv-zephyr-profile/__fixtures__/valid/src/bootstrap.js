export const resolveRemote = topology =>
  topology.remotes.find(remote => remote.id === 'catalog');

export const createServiceClient = topology =>
  topology.services.find(service => service.id === 'inventory-api');
