import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./electron-mock-loader.js', pathToFileURL(import.meta.dirname + '/'));
