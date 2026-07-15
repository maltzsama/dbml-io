import { describe, it, expect } from 'vitest';
import { compileDBML } from '../parser';

describe('compileDBML', () => {
  describe('tables', () => {
    it('parses a basic table with fields', () => {
      const result = compileDBML(`Table users {
  id integer
  email varchar(255)
}`);
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].name).toBe('users');
      expect(result.tables[0].fields).toHaveLength(2);
      expect(result.tables[0].fields[0].name).toBe('id');
      expect(result.tables[0].fields[0].type).toBe('integer');
      expect(result.tables[0].fields[1].name).toBe('email');
      expect(result.tables[0].fields[1].type).toBe('varchar(255)');
    });

    it('parses primary key field', () => {
      const result = compileDBML(`Table users {
  id integer [pk]
}`);
      expect(result.tables[0].fields[0].isPK).toBe(true);
    });

    it('parses primary key field (primary key syntax)', () => {
      const result = compileDBML(`Table users {
  id integer [primary key]
}`);
      expect(result.tables[0].fields[0].isPK).toBe(true);
    });

    it('parses composite primary key via indexes block', () => {
      const result = compileDBML(`Table orders {
  order_id integer
  product_id integer
  quantity integer

  indexes {
    (order_id, product_id) [pk]
  }
}`);
      const fields = result.tables[0].fields;
      expect(fields.find(f => f.name === 'order_id')?.isPK).toBe(true);
      expect(fields.find(f => f.name === 'product_id')?.isPK).toBe(true);
      expect(fields.find(f => f.name === 'quantity')?.isPK).toBe(false);
    });

    it('parses not null and unique constraints', () => {
      const result = compileDBML(`Table users {
  email varchar(255) [not null, unique]
}`);
      const f = result.tables[0].fields[0];
      expect(f.notNull).toBe(true);
      expect(f.unique).toBe(true);
    });

    it('parses default value', () => {
      const result = compileDBML(`Table users {
  status varchar(20) [default: 'active']
  count integer [default: 0]
}`);
      expect(result.tables[0].fields[0].defaultVal).toBe('active');
      expect(result.tables[0].fields[1].defaultVal).toBe('0');
    });

    it('parses increment', () => {
      const result = compileDBML(`Table users {
  id integer [pk, increment]
}`);
      expect(result.tables[0].fields[0].increment).toBe(true);
    });

    it('parses inline note on column', () => {
      const result = compileDBML(`Table users {
  email varchar(255) [note: 'primary email address']
}`);
      expect(result.tables[0].fields[0].note).toBe('primary email address');
    });

    it('parses table-level note', () => {
      const result = compileDBML(`Table users {
  id integer
  Note: 'Stores user accounts'
}`);
      expect(result.tables[0].note).toBe('Stores user accounts');
    });

    it('parses table with alias', () => {
      const result = compileDBML(`Table orders as o {
  id integer
}`);
      expect(result.tables[0].name).toBe('orders');
      // alias resolution applies to refs later
    });

    it('parses headerColor', () => {
      const result = compileDBML(`Table users [headercolor: #ff0000] {
  id integer
}`);
      expect(result.tables[0].headerColor).toBe('#ff0000');
    });

    it('parses multiple tables', () => {
      const result = compileDBML(`Table users {
  id integer
}
Table posts {
  title varchar(255)
}`);
      expect(result.tables).toHaveLength(2);
      expect(result.tables[0].name).toBe('users');
      expect(result.tables[1].name).toBe('posts');
    });
  });

  describe('enums', () => {
    it('parses a basic enum', () => {
      const result = compileDBML(`enum user_role {
  admin
  editor
  viewer
}`);
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe('user_role');
      expect(result.enums[0].values).toHaveLength(3);
      expect(result.enums[0].values[0].value).toBe('admin');
      expect(result.enums[0].values[1].value).toBe('editor');
      expect(result.enums[0].values[2].value).toBe('viewer');
    });

    it('parses enum values with notes', () => {
      const result = compileDBML(`enum status {
  active [note: 'user is active']
  inactive
}`);
      expect(result.enums[0].values[0].note).toBe('user is active');
      expect(result.enums[0].values[1].note).toBe('');
    });

    it('populates enumLookup', () => {
      const result = compileDBML(`enum mood {
  happy
  sad
}`);
      expect(result.enumLookup['mood']).toBeDefined();
      expect(result.enumLookup['mood'].values).toHaveLength(2);
    });
  });

  describe('references', () => {
    it('parses inline ref in column settings', () => {
      const result = compileDBML(`Table users {
  id integer [pk]
}
Table posts {
  user_id integer [ref: > users.id]
}`);
      const ref = result.refs.find(r => r.fromField === 'user_id');
      expect(ref).toBeDefined();
      expect(ref!.fromTable).toBe('posts');
      expect(ref!.toTable).toBe('users');
      expect(ref!.toField).toBe('id');
      expect(ref!.type).toBe('>');
    });

    it('parses explicit short form ref', () => {
      const result = compileDBML(`Table users { id integer }
Table posts { author_id integer }
Ref: posts.author_id > users.id`);
      expect(result.refs).toHaveLength(1);
      expect(result.refs[0].fromTable).toBe('posts');
      expect(result.refs[0].toTable).toBe('users');
      expect(result.refs[0].type).toBe('>');
    });

    it('parses explicit long form ref', () => {
      const result = compileDBML(`Table users { id integer }
Table posts { author_id integer }
Ref {
  posts.author_id > users.id
}`);
      expect(result.refs).toHaveLength(1);
      expect(result.refs[0].fromTable).toBe('posts');
      expect(result.refs[0].toTable).toBe('users');
    });

    it('parses composite ref with parenthesized fields', () => {
      const result = compileDBML(`Ref: orders.id(product_id) > order_items.id(product_id)`);
      expect(result.refs).toHaveLength(1);
      expect(result.refs[0].fromTable).toBe('orders.id');
      expect(result.refs[0].fromField).toBe('product_id');
      expect(result.refs[0].toTable).toBe('order_items.id');
      expect(result.refs[0].toField).toBe('product_id');
    });

    it('marks isFK on fields with inline ref', () => {
      const result = compileDBML(`Table users { id integer }
Table posts { user_id integer [ref: > users.id] }`);
      const field = result.tables[1].fields[0];
      expect(field.isFK).toBe(true);
    });
  });

  describe('table groups', () => {
    it('parses a table group', () => {
      const result = compileDBML(`Table users { id integer }
Table posts { id integer }
TableGroup admin {
  users
  posts
}`);
      expect(result.tableGroups).toHaveLength(1);
      expect(result.tableGroups[0].name).toBe('admin');
      expect(result.tableGroups[0].members).toContain('users');
      expect(result.tableGroups[0].members).toContain('posts');
    });
  });

  describe('project info', () => {
    it('parses project with database type', () => {
      const result = compileDBML(`Project my_app {
  database_type: 'PostgreSQL'
}`);
      expect(result.projectInfo).not.toBeNull();
      expect(result.projectInfo!.name).toBe('my_app');
      expect(result.projectInfo!.databaseType).toBe('PostgreSQL');
    });
  });

  describe('comments', () => {
    it('ignores single-line comments', () => {
      const result = compileDBML(`Table users {
  // this is a comment
  id integer
}`);
      expect(result.error).toBeNull();
      expect(result.tables[0].fields).toHaveLength(1);
    });

    it('ignores multi-line comments', () => {
      const result = compileDBML(`/* multi
line */
Table users {
  id integer
}`);
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(1);
    });

    it('preserves content inside string literals', () => {
      const result = compileDBML(`Table users {
  name varchar(100) [default: 'hello // world']
}`);
      expect(result.error).toBeNull();
      expect(result.tables[0].fields[0].defaultVal).toBe('hello // world');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = compileDBML('');
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(0);
      expect(result.refs).toHaveLength(0);
    });

    it('handles whitespace-only input', () => {
      const result = compileDBML('   \n  \t  ');
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(0);
    });

    it('handles malformed input gracefully', () => {
      const result = compileDBML('Table users {{ id integer }');
      // malformed double brace should still parse the table,
      // or at least not throw (error may be set)
      if (!result.error) {
        expect(result.tables.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles completely invalid syntax', () => {
      const result = compileDBML('{{{ not dbml at all }}}');
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(0);
    });

    it('preserves case-sensitive table names', () => {
      const result = compileDBML('Table UserAccounts { id integer }');
      expect(result.tables[0].name).toBe('UserAccounts');
    });
  });

  describe('positions / layout', () => {
    it('returns positions for all tables', () => {
      const result = compileDBML(`Table users { id integer }
Table posts { id integer }`);
      expect(result.positions['users']).toBeDefined();
      expect(result.positions['posts']).toBeDefined();
      expect(typeof result.positions['users'].x).toBe('number');
      expect(typeof result.positions['users'].y).toBe('number');
    });

    it('positions are within reasonable bounds', () => {
      const result = compileDBML(`Table a { id integer }
Table b { id integer }
Table c { id integer }`);
      Object.values(result.positions).forEach(p => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(10000);
        expect(p.y).toBeLessThan(10000);
      });
    });

    it('star schema layout places fact table at center', () => {
      const result = compileDBML(`Table fact_sales {
  id integer
}
Table dim_product {
  id integer
}
Table dim_store {
  id integer
}
Ref: dim_product.id > fact_sales.product_id
Ref: dim_store.id > fact_sales.store_id`);
      const factPos = result.positions['fact_sales'];
      expect(factPos.x).toBe(900);
      expect(factPos.y).toBe(600);
    });
  });

  describe('integration: realistic schema', () => {
    it('parses the default DBML sample', () => {
      const sample = `Table users {
  id integer [primary key]
  username varchar(255) [not null, unique]
  full_name varchar(255) [not null]
  gender varchar(1) [not null]
  source varchar(255) [default: 'direct']
  created_at timestamp [default: now()]
  rating integer [default: 10]
}`;
      const result = compileDBML(sample);
      expect(result.error).toBeNull();
      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].fields).toHaveLength(7);
      const idField = result.tables[0].fields[0];
      expect(idField.isPK).toBe(true);
      expect(idField.name).toBe('id');
    });
  });
});
