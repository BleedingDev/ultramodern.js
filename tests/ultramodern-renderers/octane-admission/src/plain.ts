import { useState } from 'octane';

export function useAdmissionCount() {
  return useState(0);
}
