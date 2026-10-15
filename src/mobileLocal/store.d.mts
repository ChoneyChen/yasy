export function createLocalStore(options?: {load?:()=>Promise<unknown>;save?:(value:unknown,restoring:boolean)=>Promise<unknown>;bank?:unknown}):Promise<any>;
