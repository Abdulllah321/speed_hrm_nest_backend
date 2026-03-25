const fs = require('fs');
const path = require('path');

const targetFile = 'e:/M Umair/SPEEDLIMITED/speed_hrm_nest_backend/src/config/permissions.ts';

const modules = [
  { prefix: 'master.brand', name: 'Brand', entity: 'Brand' },
  { prefix: 'master.division', name: 'Division', entity: 'Division' },
  { prefix: 'master.channel-class', name: 'Channel Class', entity: 'Channel Class' },
  { prefix: 'master.color', name: 'Color', entity: 'Color' },
  { prefix: 'master.gender', name: 'Gender', entity: 'Gender' },
  { prefix: 'master.size', name: 'Size', entity: 'Size' },
  { prefix: 'master.silhouette', name: 'Silhouette', entity: 'Silhouette' },
  { prefix: 'master.tax-rate', name: 'Tax Rate', entity: 'Tax Rate' },
  { prefix: 'erp.item-class', name: 'Item Class', entity: 'Item Class' },
  { prefix: 'erp.item-subclass', name: 'Item Subclass', entity: 'Item Subclass' },
  { prefix: 'erp.old-season', name: 'Old Season', entity: 'Old Season' },
  { prefix: 'erp.season', name: 'Season', entity: 'Season' },
  { prefix: 'erp.segment', name: 'Segment', entity: 'Segment' },
  { prefix: 'hs-code', name: 'HS Code', entity: 'HS Code' }
];

const actions = ['create', 'read', 'update', 'delete'];

let newPermissionsStr = '';

modules.forEach(mod => {
  newPermissionsStr += `\n  // ${mod.name}\n`;
  actions.forEach(action => {
    let actionCap = action.charAt(0).toUpperCase() + action.slice(1);
    newPermissionsStr += `  {
    name: '${mod.prefix}.${action}',
    module: '${mod.prefix}',
    action: '${action}',
    description: '${actionCap} ${mod.entity}',
  },\n`;
  });
});

let content = fs.readFileSync(targetFile, 'utf8');

// We want to insert this right before "// ERP Category"
content = content.replace('  // ERP Category', newPermissionsStr + '  // ERP Category');

fs.writeFileSync(targetFile, content);
console.log('Added missing permissions successfully.');
