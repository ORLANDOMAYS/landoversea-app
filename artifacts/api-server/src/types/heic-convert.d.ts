declare module "heic-convert" {
  type HeicOutputFormat = "JPEG" | "PNG";

  type HeicConvertOptions = {
    buffer: Buffer | Uint8Array | ArrayBuffer;
    format: HeicOutputFormat;
    quality?: number;
  };

  type HeicConvert = {
    (options: HeicConvertOptions): Promise<Buffer | Uint8Array | ArrayBuffer>;
  };

  const convert: HeicConvert;
  export default convert;
}