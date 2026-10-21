// The built dashboard page, inlined as text by tsup's loader (see tsup.config.ts).
declare module "*.html" {
  const html: string;
  export default html;
}
