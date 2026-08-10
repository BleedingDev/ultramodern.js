// @ts-expect-error This implementation detail must not cross the public export.
import { setBuildConfigEnvironment } from '@modern-js/app-tools/config';

void setBuildConfigEnvironment;
