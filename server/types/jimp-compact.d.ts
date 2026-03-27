declare module "jimp-compact" {
  const Jimp: {
    read(buffer: Buffer): Promise<any>;
    [key: string]: any;
  };
  export = Jimp;
}
