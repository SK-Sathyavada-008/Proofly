const fs = require('fs');
const path = require('path');

// Exact transpiler from javaSolutionEvaluator.ts
function transpileJavaToJs(javaCode) {
  let js = javaCode;
  js = js.replace(/package\s+[\w\.]+;/g, '');
  js = js.replace(/import\s+[\w\.\*]+;/g, '');
  js = js.replace(/public\s+class\s+\w+[^{]*\{/, '');
  const lastBrace = js.lastIndexOf('}');
  if (lastBrace !== -1) {
    js = js.substring(0, lastBrace) + js.substring(lastBrace + 1);
  }
  js = js.replace(/System\.out\.println\s*\(([\s\S]*?)\);/g, '__stdout.push(String($1));');
  js = js.replace(/System\.out\.print\s*\(([\s\S]*?)\);/g, '__stdout.push(String($1));');
  js = js.replace(/System\.out\.printf\s*\(([\s\S]*?)\);/g, '__stdout.push(String($1));');
  js = js.replace(/for\s*\(\s*(?:int|String|char|double|float|long|boolean)\s+(\w+)\s*:\s*(\w+)\s*\)/g, 'for (let $1 of $2)');
  js = js.replace(/public\s+static\s+void\s+main\s*\([^)]*\)\s*\{/g, 'function __main__() {');
  js = js.replace(/static\s+(?:int|void|String|boolean|double|float|char)\s+(\w+)\s*\(([^)]*)\)\s*\{/g, (_m, name, args) => {
    const cleanArgs = args
      .split(',')
      .filter(Boolean)
      .map((a) => a.trim().split(/\s+/).pop())
      .join(', ');
    return `function ${name}(${cleanArgs}) {`;
  });
  js = js.replace(/new\s+(?:int|String|char|double|float|long|boolean)\[\]\s*\{([^}]*)\}/g, '[$1]');
  js = js.replace(/\b(?:int|double|float|boolean|String|char|long)(?:\[\])?\s+(\w+)/g, 'let $1');
  js = js.replace(/\.length\(\)/g, '.length');
  js += '\nif (typeof __main__ === "function") __main__();\n';
  return js;
}

function executeJavaSnippet(javaCode) {
  try {
    const js = transpileJavaToJs(javaCode);
    const __stdout = [];
    const fn = new Function('__stdout', js);
    fn(__stdout);
    return { success: true, output: __stdout.join('\n').trim() };
  } catch (err) {
    return { success: false, output: '', error: err?.message || 'Execution error' };
  }
}

function extractAllLinkedIssues(text) {
  const found = new Set();
  const keywordBlockRegex = /(?:fixes|closed|closes|fixed|resolves|resolved|challenge|issue|task)[\s\-_:#]*([#\d\s,\-_;&and]+)/gi;
  let blockMatch;
  while ((blockMatch = keywordBlockRegex.exec(text)) !== null) {
    const numbersInBlock = blockMatch[1].match(/\d+/g);
    if (numbersInBlock) {
      numbersInBlock.forEach((numStr) => {
        const n = parseInt(numStr, 10);
        if (n > 0) found.add(n);
      });
    }
  }
  const hashRegex = /#(\d+)/g;
  let hashMatch;
  while ((hashMatch = hashRegex.exec(text)) !== null) {
    const n = parseInt(hashMatch[1], 10);
    if (n > 0) found.add(n);
  }
  return Array.from(found).sort((a, b) => a - b);
}

function getPointsForDifficulty(diff) {
  switch (diff) {
    case 'VERY_HARD': return 40;
    case 'HARD': return 30;
    case 'MEDIUM': return 20;
    default: return 10;
  }
}

const sampleSolutions = [
  {
    code: `public class Solution {
      public static void main(String[] args) {
        int n = 4;
        if (n % 2 == 0) {
          System.out.println("Result: Even");
        } else {
          System.out.println("Result: Odd");
        }
      }
    }`,
    expected: 'Result: Even',
    diff: 'EASY'
  },
  {
    code: `public class Solution {
      public static void main(String[] args) {
        int a = 10;
        int b = 25;
        int c = 15;
        int max = a;
        if (b > max) max = b;
        if (c > max) max = c;
        System.out.println("Champion: " + max);
      }
    }`,
    expected: 'Champion: 25',
    diff: 'MEDIUM'
  },
  {
    code: `public class Solution {
      public static void main(String[] args) {
        System.out.println("Buggy solution output");
      }
    }`,
    expected: 'Champion: 25',
    diff: 'HARD'
  }
];

function runScaleSimulation() {
  console.log('='.repeat(75));
  console.log('PRISON BREAK ARCHITECTURE STRESS-TEST & SIMULATION BENCHMARK');
  console.log('='.repeat(75));

  // Scenario 1: 150 PRs total across 35 repos (4-5 PRs per repo within 10 mins)
  console.log('\n>>> SCENARIO 1: 150 PRs in Total Across 35 Repositories (10-minute window)');
  runSimulation({ numRepos: 35, totalPRs: 150, timeWindowSeconds: 600 });

  // Scenario 2: 150 PRs PER REPO across 35 repos = 5,250 PRs within 10 mins
  console.log('\n>>> SCENARIO 2: 150 PRs Per Repo across 35 Repos = 5,250 PRs (10-minute window)');
  runSimulation({ numRepos: 35, totalPRs: 5250, timeWindowSeconds: 600 });
}

function runSimulation({ numRepos, totalPRs, timeWindowSeconds }) {
  const teams = {};
  for (let i = 1; i <= numRepos; i++) {
    teams[`team_squade_${i}`] = {
      id: `team_squade_${i}`,
      name: `Squad ${i}`,
      repo: `Squade_${i}`,
      score: 0,
      solvedIssues: new Set(),
      prsProcessed: 0,
      prsApproved: 0,
      prsRejected: 0
    };
  }

  const scoreEvents = new Set();
  let evaluatedPRCount = 0;
  let correctlyGradedCount = 0;
  let rejectedCount = 0;

  // Track Firestore write collisions (writes to same team doc in same second)
  const teamDocWriteSeconds = {};
  let firestoreDocCollisions = 0;

  const prIntervalSec = timeWindowSeconds / totalPRs;

  const tStart = performance.now();

  for (let p = 1; p <= totalPRs; p++) {
    const repoIndex = ((p - 1) % numRepos) + 1;
    const teamId = `team_squade_${repoIndex}`;
    const team = teams[teamId];
    const author = `student_${(p % 300) + 1}`;
    const issueNum = (p % 80) + 1;

    const prTitle = `Fixes #${issueNum} in ${team.repo}`;
    const prBody = `Closes #${issueNum} solution implemented cleanly.`;
    const sol = sampleSolutions[(p - 1) % sampleSolutions.length];

    // 1. Linked issues detection
    const linkedIssues = extractAllLinkedIssues(`${prTitle} ${prBody}`);

    // 2. Deterministic code evaluation
    const execRes = executeJavaSnippet(sol.code);
    const isCorrect = execRes.success && execRes.output.includes(sol.expected);

    evaluatedPRCount++;
    team.prsProcessed++;

    if (isCorrect) {
      correctlyGradedCount++;
      team.prsApproved++;

      for (const num of linkedIssues) {
        const idempKey = `se_${teamId}_issue_${num}`;
        if (!scoreEvents.has(idempKey)) {
          scoreEvents.add(idempKey);
          const pts = getPointsForDifficulty(sol.diff);
          team.score += pts;
          team.solvedIssues.add(num);
        }
      }
    } else {
      rejectedCount++;
      team.prsRejected++;
    }

    // Contention detection
    const simSec = Math.floor(p * prIntervalSec);
    if (!teamDocWriteSeconds[teamId]) teamDocWriteSeconds[teamId] = {};
    if (teamDocWriteSeconds[teamId][simSec]) {
      firestoreDocCollisions++;
    } else {
      teamDocWriteSeconds[teamId][simSec] = true;
    }
  }

  const tEnd = performance.now();
  const elapsedMs = tEnd - tStart;
  const throughput = Math.round(totalPRs / (elapsedMs / 1000));

  console.log(`\n  [1] EXECUTION SPEED & THROUGHPUT:`);
  console.log(`      - Total PRs Graded: ${evaluatedPRCount}`);
  console.log(`      - Time to grade all PRs in memory: ${elapsedMs.toFixed(2)} ms`);
  console.log(`      - Throughput: ${throughput.toLocaleString()} PR evaluations/second`);
  console.log(`      - Pass Count: ${correctlyGradedCount} | Reject Count: ${rejectedCount}`);
  console.log(`      - Unique Solved Issues Scored: ${scoreEvents.size}`);
  console.log(`      - Top Squad Score: ${Math.max(...Object.values(teams).map(t => t.score))} XP`);

  console.log(`\n  [2] TRAFFIC PROFILE (10-minute window = 600s):`);
  const prsPerMin = (totalPRs / 10).toFixed(1);
  const prsPerSec = (totalPRs / 600).toFixed(2);
  console.log(`      - Ingestion Rate: ${prsPerMin} PRs/min (${prsPerSec} PRs/sec)`);

  console.log(`\n  [3] INFRASTRUCTURE BOTTLENECK ANALYSIS:`);
  
  // A. GitHub API Rate Limit
  const ghCallsPerPR = 3; // PR metadata, commit list, diff files
  const totalGhCalls = totalPRs * ghCallsPerPR;
  console.log(`      a) GitHub API:`);
  console.log(`         - Polling/Sync Calls: ~${totalGhCalls.toLocaleString()} calls.`);
  if (totalGhCalls > 5000) {
    console.log(`         -> STATUS: ❌ FAILS with HTTP 403 / 429 Rate Limit (PAT limit is 5,000/hr).`);
    console.log(`         -> REMEDY: Webhooks must be used instead of client polling, or split across multiple GitHub App installations.`);
  } else {
    console.log(`         -> STATUS: ✅ PASSES under GitHub PAT limit (5,000 req/hr).`);
  }

  // B. AI Review (Gemini LLM)
  console.log(`      b) Gemini AI Review Engine:`);
  console.log(`         - Required Gemini calls: ${totalPRs.toLocaleString()} calls.`);
  if (totalPRs > 150) {
    console.log(`         -> STATUS: ❌ Free tier (15 RPM) exhausted in ~17 seconds!`);
    console.log(`         -> REMEDY: System automatically falls back to Heuristic/Deterministic Judge (0 ms latency).`);
  } else {
    console.log(`         -> STATUS: ⚠️ Free tier (15 RPM) at 100% capacity (15 PRs/min). Paid Tier 1 (1,000 RPM) recommended.`);
  }

  // C. Firebase Firestore
  console.log(`      c) Database (Firestore):`);
  const totalWrites = totalPRs * 4;
  console.log(`         - Estimated writes: ~${totalWrites.toLocaleString()}`);
  console.log(`         - Document write collisions (>1 write/sec to same Squad doc): ${firestoreDocCollisions}`);
  if (totalWrites > 20000) {
    console.log(`         -> STATUS: ❌ Exceeds Firebase Spark Free Tier (20,000 writes/day).`);
    console.log(`         -> REMEDY: Requires Firebase Blaze pay-as-you-go plan.`);
  } else {
    console.log(`         -> STATUS: ✅ Fits within Firestore daily free quota.`);
  }
}

runScaleSimulation();
