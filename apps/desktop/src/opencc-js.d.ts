declare module "opencc-js/t2cn" {
  export function Converter(options: { from: "tw"; to: "cn" }): (text: string) => string;
}
