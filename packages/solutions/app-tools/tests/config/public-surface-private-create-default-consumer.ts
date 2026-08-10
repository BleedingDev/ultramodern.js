// @ts-expect-error This implementation detail must not cross the public export.
import { createDefaultConfig } from '@modern-js/app-tools/config';

void createDefaultConfig;
