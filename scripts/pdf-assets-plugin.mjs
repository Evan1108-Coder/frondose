import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const packageRoot=fileURLToPath(new URL('../node_modules/pdfjs-dist/',import.meta.url));
/** Trusted, pinned decoder/font resources only; never workspace files. */
export function pdfAssetsPlugin(){
  return {name:'frondose-pdf-resources',generateBundle(){
    for(const [pkg,name]of [['pdfjs-dist','pdfjs.txt'],['mermaid','mermaid.txt']])this.emitFile({type:'asset',fileName:'licenses/'+name,source:readFileSync(fileURLToPath(new URL('../node_modules/'+pkg+'/LICENSE',import.meta.url)))});
    for(const folder of ['cmaps','standard_fonts','wasm','iccs'])for(const entry of readdirSync(join(packageRoot,folder),{withFileTypes:true})){
      if(entry.isFile()&&!entry.isSymbolicLink())this.emitFile({type:'asset',fileName:'pdfjs/'+folder+'/'+entry.name,source:readFileSync(join(packageRoot,folder,entry.name))});
    }
  }};
}
