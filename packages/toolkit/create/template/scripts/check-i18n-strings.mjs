#!/usr/bin/env node
import { runSingleAppI18nCheck } from '@modern-js/ultramodern-checks';

process.exitCode = runSingleAppI18nCheck({ cwd: process.cwd() });
