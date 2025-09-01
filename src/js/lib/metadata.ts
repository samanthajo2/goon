import ExifReader from 'exifreader'
import { isImageExtension, isVideoExtension } from './filters';
import { extractData } from './mp4parse';

export async function getMetaData(filename: string) {
  if (isImageExtension(filename)) {
    return await ExifReader.load(filename);
  } else if (isVideoExtension(filename)) {

    return await extractData(filename);
    // Future: implement video metadata extraction if needed
    throw new Error('Video metadata extraction not implemented yet.');
  } else {
    // not yet supported.
    throw new Error(`metadata extraction not implemented yet for: ${filename}`);
  }
}