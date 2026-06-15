const fs = require('fs');

const data = [
  { p: "Priya", a: 3000, s: ["Rohan", "Priya", "Sam"] }, // 43
  { p: "Aisha", a: 12000, s: ["Rohan", "Priya", "Sam"] }, // 42
  { p: "Sam", a: 1990, s: ["Rohan", "Priya", "Sam"] }, // 41
  { p: "Aisha", a: 1380, s: ["Rohan", "Priya", "Sam"] }, // 40
  { p: "Sam", a: 3100, s: ["Rohan", "Priya", "Sam"] }, // 39
  // 38 Sam deposit share (skipped by EXCLUDE_KEYWORDS)
  { p: "Rohan", a: 1199, s: ["Rohan", "Priya"] }, // 37
  { p: "Priya", a: 2640, s: ["Rohan", "Priya", "Meera"] }, // 36
  { p: "Aisha", a: 48000, s: ["Aisha", "Aisha", "Rohan", "Priya"] }, // 35 ratio
  { p: "Rohan", a: 2500, s: ["Rohan", "Priya"] }, // 34
  { p: "Aisha", a: 4800, s: ["Rohan", "Priya", "Meera"] }, // 33
  { p: "Meera", a: 2200, s: ["Aisha", "Rohan", "Priya", "Meera"], r: [30/110, 30/110, 30/110, 20/110] }, // 32
  // 31 dinner order swiggy 0 (skipped)
  { p: "Meera", a: 3000, s: ["Rohan", "Priya", "Meera"] }, // 30
  { p: "Aisha", a: 1450, s: ["Rohan", "Priya", "Meera"] }, // 29
  { p: "Priya", a: 2105, s: ["Rohan", "Priya", "Meera"] }, // 28
  { p: "Rohan", a: 1100, s: ["Rohan", "Priya", "Dev"] }, // 27
  { p: "Dev", a: -30, s: ["Rohan", "Priya", "Dev"] }, // 26 refund (so Dev -30, splits +10)
  { p: "Rohan", a: 2450, s: ["Rohan", "Priya", "Dev"] }, // 25
  { p: "Aisha", a: 2400, s: ["Rohan", "Priya", "Dev"] }, // 24
  { p: "Dev", a: 150*95.12, s: ["Rohan", "Priya", "Dev"] }, // 23 (150 usd * 95.12 = 14268)
  { p: "Priya", a: 3600, s: ["Aisha", "Rohan", "Rohan", "Priya", "Dev", "Dev"] }, // 22 ratio 1:2:1:2
  { p: "Rohan", a: 84*95.12, s: ["Rohan", "Priya", "Dev"] }, // 21 (84 * 95.12 = 7990.08)
  { p: "Dev", a: 540*95.12, s: ["Rohan", "Priya", "Dev"] }, // 20 (540 * 95.12 = 51364.8)
  { p: "Aisha", a: 32400, s: ["Rohan", "Priya", "Dev"] }, // 19
  { p: "Rohan", a: 1199, s: ["Rohan", "Priya", "Meera"] }, // 18
  { p: "Meera", a: 2810, s: ["Rohan", "Priya", "Meera"] }, // 17
  { p: "Aisha", a: 48000, s: ["Rohan", "Priya", "Meera"] }, // 16
  { p: "Aisha", a: 1440, s: ["Aisha", "Rohan", "Priya", "Meera"], r: [30/110, 30/110, 30/110, 20/110] }, // 15
  // 14 Rohan paid Aisha back 5000 (settlement)
  // 13 House cleaning supplies 780 (skipped)
  { p: "Rohan", a: 1500, exact: { Rohan: 700, Priya: 400, Meera: 400 } }, // 12
  { p: "Priya", a: 1875, s: ["Rohan", "Priya", "Meera"] }, // 11
  { p: "Rohan", a: 899.995, s: ["Rohan", "Priya", "Meera"] }, // 10
  { p: "Priya", a: 640, s: ["Rohan", "Priya"] }, // 9
  { p: "Meera", a: 3000, s: ["Rohan", "Priya", "Meera"] }, // 8
  { p: "Aisha", a: 1200, s: ["Rohan", "Priya", "Meera"] }, // 7
  // 6 dinner marina bites 3200 (skipped)
  { p: "Dev", a: 3200, s: ["Rohan", "Priya", "Dev"] }, // 5
  { p: "Rohan", a: 1199, s: ["Rohan", "Priya", "Meera"] }, // 4
  { p: "Priya", a: 2340, s: ["Rohan", "Priya", "Meera"] }, // 3
  { p: "Aisha", a: 48000, s: ["Rohan", "Priya", "Meera"] }, // 2
];

function run() {
  const balances = { Priya: 0, Aisha: 0, Sam: 0, Rohan: 0, Meera: 0, Dev: 0 };
  for (const d of data) {
    balances[d.p] += d.a;
    if (d.exact) {
      for (const k in d.exact) balances[k] -= d.exact[k];
    } else if (d.r) {
      for (let i=0; i<d.s.length; i++) balances[d.s[i]] -= d.a * d.r[i];
    } else {
      const splitAmt = d.a / d.s.length;
      for (const u of d.s) balances[u] -= splitAmt;
    }
  }

  // add settlement
  balances["Rohan"] += 5000;
  balances["Aisha"] -= 5000;

  console.log("BALANCES:", balances);

  let creditors = Object.entries(balances).filter(e => e[1] > 0.01).map(e => ({ name: e[0], balance: e[1] })).sort((a,b) => b.balance - a.balance);
  let debtors = Object.entries(balances).filter(e => e[1] < -0.01).map(e => ({ name: e[0], balance: e[1] })).sort((a,b) => a.balance - b.balance);

  const tx = [];
  while(creditors.length && debtors.length) {
    const c = creditors[0];
    const d = debtors[0];
    const amt = Math.min(c.balance, Math.abs(d.balance));
    tx.push(`${d.name} -> ${c.name} : ${amt}`);
    c.balance -= amt;
    d.balance += amt;
    if(c.balance < 0.01) creditors.shift();
    if(d.balance > -0.01) debtors.shift();
    creditors.sort((a,b) => b.balance - a.balance);
    debtors.sort((a,b) => a.balance - b.balance);
  }
  console.log("TX:", tx);
}

run();
