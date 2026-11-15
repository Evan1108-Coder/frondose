import {File,FileCode,FileJson,FileCog,FileKey,FileLock,FileBox,FileImage,FileArchive,FileAudio,FileVideo,FileSpreadsheet,FileType,FileTerminal,FileText,Database} from './icons.jsx';
import {fileIconKind} from '../lib/file-icon.js';
const icons={file:File,code:FileCode,data:FileJson,config:FileCog,environment:FileKey,lock:FileLock,package:FileBox,image:FileImage,archive:FileArchive,audio:FileAudio,video:FileVideo,table:FileSpreadsheet,font:FileType,shell:FileTerminal,document:FileText,database:Database};
export function FileIcon({path,...props}){const kind=fileIconKind(path),Icon=icons[kind];return <Icon interactive={false} aria-hidden="true" data-file-kind={kind} {...props}/>;}
