import ExifReader from 'exifreader'
import { isImageExtension, isMimeImage, isMimeVideo, isVideoExtension } from './filters.js';
import { extractData } from './mp4parse.js';

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

export async function getGenerationData(url: string, type: string, filename: string) {
  if (isMimeImage(type)) {
    const ab = await (await fetch(url)).arrayBuffer();
    return ExifReader.load(ab);
  } else if (isMimeVideo(type)) {
    const data = await extractData(url);
    if (!data.comment) {
      throw new Error(`No generation data found in video file: ${filename}`);
    }
    return JSON.parse(data.comment);
  } else {
    // not yet supported.
    throw new Error(`generation data extraction not implemented yet for: ${filename}`);
  }
}