import ExifReader from 'exifreader'
import { isImageExtension, isVideoExtension } from './filters';
import { extractData } from './mp4parse';

export async function getMetaData(filename: string) {
  if (isImageExtension(filename)) {
    return await ExifReader.load(filename);
  } else if (isVideoExtension(filename)) {
    return await extractData(filename);
  } else {
    // not yet supported.
    throw new Error(`metadata extraction not implemented yet for: ${filename}`);
  }
}

export async function getGenerationData(filename: string) {
  if (isImageExtension(filename)) {
    return await ExifReader.load(filename);
  } else if (isVideoExtension(filename)) {
    const data = await extractData(filename);
    if (!data.comment) {
      throw new Error(`No generation data found in video file: ${filename}`);
    }
    return JSON.parse(data.comment);
  } else {
    // not yet supported.
    throw new Error(`generation data extraction not implemented yet for: ${filename}`);
  }
}