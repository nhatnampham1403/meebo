/**
 * P2.T2 — Team member seed script
 *
 * HOW TO USE:
 * 1. Fill in the TEAM array below with your actual team members.
 *    - display_name: the name you use internally (must match what the AI assigns as "owner")
 *    - trello_username: the person's Trello username (run this script once with TEAM=[]
 *      to see all board members printed, then match by name)
 *    - role + skills: used by the AI for smart assignment
 * 2. Run: npx tsx scripts/seed-members.ts
 *
 * The script first prints all board members so you can confirm Trello usernames.
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// ─── FILL THIS IN ─────────────────────────────────────────────────────────────
const TEAM: Array<{
  display_name: string;
  trello_username: string;
  email: string | null;
  role: string;
  skills: string[];
}> = [
  {
    display_name: 'Bach Nguyen',
    trello_username: 'bachnt97',
    email: null,                          // fill real emails when you have them
    role: 'TODO: their real role',
    skills: ['TODO', 'add', 'real skills'],
  },
  {
    display_name: 'Hải Dương Nguyễn',
    trello_username: 'hidngnguyn5',
    email: null,
    role: 'TODO: their real role',
    skills: ['TODO', 'add', 'real skills'],
  },
  {
    display_name: 'Long Pham',
    trello_username: 'longpham161',
    email: null,
    role: 'TODO: their real role',
    skills: ['TODO', 'add', 'real skills'],
  },
  {
    display_name: 'Nhật Nam Phạm',
    trello_username: 'nhtnamphm',
    email: null,
    role: 'TODO: their real role',
    skills: ['TODO', 'add', 'real skills'],
  },
  {
    display_name: 'Thái Dương',
    trello_username: 'thaidng',
    email: null,
    role: 'TODO: their real role',
    skills: ['TODO', 'add', 'real skills'],
  },
  {
    display_name: 'Đặng Thanh Tùng',
    trello_username: 'tungdt226',
    email: null,
    role: 'TODO: their real role',
    skills: ['TODO', 'add', 'real skills'],
  },
];
// ──────────────────────────────────────────────────────────────────────────────

const TRELLO_KEY = process.env.TRELLO_KEY!;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN!;
const TRELLO_BOARD_ID = process.env.TRELLO_BOARD_ID!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!TRELLO_KEY || !TRELLO_TOKEN || !TRELLO_BOARD_ID) {
  console.error('Missing TRELLO_KEY, TRELLO_TOKEN, or TRELLO_BOARD_ID in .env');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

interface BoardMember {
  id: string;
  fullName: string;
  username: string;
}

async function fetchBoardMembers(): Promise<BoardMember[]> {
  const res = await fetch(
    `https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/members?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`,
  );
  if (!res.ok) throw new Error(`Trello error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<BoardMember[]>;
}

async function main() {
  console.log('\n=== MeeBo Member Seed ===\n');

  let boardMembers: BoardMember[];
  try {
    boardMembers = await fetchBoardMembers();
  } catch (err) {
    console.error('Failed to fetch board members:', err);
    process.exit(1);
  }

  console.log('Board members on Trello:');
  for (const m of boardMembers) {
    console.log(`  id: ${m.id}  |  username: ${m.username}  |  name: ${m.fullName}`);
  }
  console.log('');

  if (TEAM.length === 0) {
    console.log(
      '⚠️  TEAM array is empty. Fill it in scripts/seed-members.ts then re-run.',
    );
    process.exit(0);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let seeded = 0;
  let errors = 0;

  for (const member of TEAM) {
    const boardMember = boardMembers.find(
      (bm) =>
        bm.username.toLowerCase() === member.trello_username.toLowerCase() ||
        bm.fullName.toLowerCase() === member.display_name.toLowerCase(),
    );

    if (!boardMember) {
      console.error(
        `✗ No Trello board member matches username "${member.trello_username}" / name "${member.display_name}"`,
      );
      errors++;
      continue;
    }

    const { error } = await supabase.from('team_members').upsert(
      {
        display_name: member.display_name,
        email: member.email,
        trello_member_id: boardMember.id,
        role: member.role,
        skills: member.skills,
        is_active: true,
      },
      { onConflict: 'trello_member_id' },
    );

    if (error) {
      console.error(`✗ Failed to upsert ${member.display_name}: ${error.message}`);
      errors++;
    } else {
      console.log(
        `✓ ${member.display_name} → Trello ID: ${boardMember.id} (${boardMember.username})`,
      );
      seeded++;
    }
  }

  console.log(`\nDone: ${seeded} seeded, ${errors} errors.`);
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
