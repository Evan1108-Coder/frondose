import {randomUUID} from 'node:crypto';
// SQLite cannot extend a CHECK constraint in place. Rebuild only this table,
// keeping its original columns, indexes, triggers, IDs and dependent foreign keys.
export function extendActivityAreas(db) {
 const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_entries'").get();
 if(!table || /target_type IN \([^)]*'area'/.test(table.sql))return;
 const constraint=/CHECK\s*\(target_type\s+IN\s+\(([^)]+)\)\)/i;
 if(!constraint.test(table.sql)){if(/CHECK\s*\([^)]*target_type/i.test(table.sql))throw Error('Unknown activity schema; no migration was applied.');return;}
 if(db.isTransaction)throw Error('Area updates require an independent schema transaction.');
 const filename=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
 if(filename)db.prepare('VACUUM INTO ?').run(filename+'.before-area-updates-'+randomUUID()+'.sqlite');
 const foreignKeys=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 const legacy=db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table;
 const before=JSON.stringify(db.prepare('PRAGMA foreign_key_check').all());
 const objects=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='activity_entries' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
 const create=table.sql.replace(/^CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?activity_entries["`]?/i,'CREATE TABLE activity_entries_area_upgrade').replace(constraint,(_,values)=>"CHECK (target_type IN ("+values+",'area'))");
 if(create===table.sql)throw Error('Unknown activity table declaration.');
 db.exec('PRAGMA foreign_keys=OFF;PRAGMA legacy_alter_table=ON;BEGIN IMMEDIATE');
 try{
  db.exec(create);
  const columns=db.prepare('PRAGMA table_info(activity_entries)').all().map(row=>'"'+row.name+'"').join(',');
  db.exec('INSERT INTO activity_entries_area_upgrade('+columns+') SELECT '+columns+' FROM activity_entries;DROP TABLE activity_entries;ALTER TABLE activity_entries_area_upgrade RENAME TO activity_entries');
  for(const object of objects)db.exec(object.sql);
  if(JSON.stringify(db.prepare('PRAGMA foreign_key_check').all())!==before)throw Error('Area update migration changed foreign-key integrity.');
  db.exec('COMMIT');
 }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
 finally{db.exec('PRAGMA foreign_keys='+foreignKeys+';PRAGMA legacy_alter_table='+legacy);}
}
