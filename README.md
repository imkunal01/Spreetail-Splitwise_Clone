# Splitwise

A collaborative expense sharing platform inspired by Splitwise, built to handle real-world shared expenses, membership changes, settlements, multi-currency transactions, and messy CSV imports.

---

## Overview

Splitwise allows groups of people (flatmates, roommates, travel groups, project teams, etc.) to track shared expenses and calculate balances fairly.

The system supports:

* Shared expense tracking
* Membership lifecycle management
* Debt simplification
* Settlement recording
* Expense audit trails
* Multi-currency expenses
* Intelligent CSV import with anomaly detection

This project was developed as part of a software engineering assessment focused on problem-solving, data modeling, system design, and handling real-world data inconsistencies.

---

## Features

### Authentication

* User Registration
* User Login
* JWT Authentication
* Protected Routes
* Secure Password Hashing using bcrypt

---

### Group Management

Users can:

* Create groups
* Join multiple groups
* Add members to groups
* Track membership history
* Mark members as inactive when they leave

Each membership contains:

* Join Date
* Leave Date (optional)

This enables historical expense calculations based on active membership periods.

---

### Expense Management

Create and manage expenses with:

* Description
* Amount
* Currency
* Date
* Payer
* Participants

Supported split methods:

#### Equal Split

Example:

Dinner ₹1200

3 members

Each owes ₹400

---

#### Exact Split

Example:

Groceries ₹900

Aisha → ₹300

Rohan → ₹400

Priya → ₹200

---

#### Percentage Split

Example:

Rent ₹10000

Aisha → 40%

Rohan → 35%

Priya → 25%

Automatically converted into monetary values.

---

### Multi-Currency Support

Supported currencies:

* INR
* USD

For USD expenses:

* Exchange rate is captured during creation/import
* Rate is stored permanently
* Historical balances never change due to future rate fluctuations

---

### Balance Engine

The system calculates:

* Total paid
* Total owed
* Net balance

Formula:

Net Balance = Total Paid − Total Owed

Positive balance:

User should receive money.

Negative balance:

User owes money.

---

### Membership Aware Calculations

Expenses are only applied if a member was active during the expense date.

Examples:

* Sam joined on April 15 → March expenses excluded
* Meera left on March 31 → April expenses excluded

This ensures accurate historical accounting.

---

### Debt Simplification

SplitMate minimizes the number of transactions required to settle debts.

Example:

Without simplification:

Aisha → Rohan ₹400

Rohan → Priya ₹400

Priya → Aisha ₹200

With simplification:

Aisha → Priya ₹200

Only one transaction required.

---

### Settlement Tracking

Users can record real-world payments.

Examples:

* Cash payment
* UPI transfer
* Bank transfer

Settlements are stored separately from expenses.

Recording settlements updates balances automatically.

---

### Expense Audit Trail

Users can inspect any balance and view:

* Which expenses contributed
* Their share in each expense
* Date-wise breakdown

Provides complete transparency and traceability.

---

### CSV Import System

The CSV Import Engine allows bulk importing expenses.

Workflow:

Upload CSV

↓

Analyze Data

↓

Detect Anomalies

↓

User Review

↓

Confirm Import

↓

Generate Report

---

### Supported CSV Anomaly Detection

The importer detects:

1. Missing Required Fields

2. Invalid Amounts

3. Negative Amounts

4. Invalid Date Formats

5. Ambiguous Dates

6. Unknown Members

7. Duplicate Expenses

8. Conflicting Duplicate Records

9. Settlement Recorded as Expense

10. Missing Currency Conversion

11. Invalid Percentage Splits

12. Future Dated Expenses

Users can review and decide how each anomaly should be handled before importing.

---

### Import Reports

After every import:

A report is generated containing:

* Total rows processed
* Successfully imported rows
* Skipped rows
* Auto-corrected rows
* Errors encountered
* Anomaly summary

---

## Technology Stack

### Frontend

* React
* Vite
* React Router
* Axios
* Tailwind CSS

### Backend

* Node.js
* Express.js

### Database

* PostgreSQL
* Prisma ORM

### Authentication

* JWT
* bcrypt

### File Processing

* csv-parse

### Deployment

Frontend:

* Vercel

Backend:

* Railway / Render

Database:

* PostgreSQL

---

## Database Design

Core entities:

* Users
* Groups
* GroupMemberships
* Expenses
* ExpenseSplits
* Settlements
* ImportLogs

Relationships:

User
↓
GroupMembership
↓
Group
↓
Expense
↓
ExpenseSplit

Settlements operate independently from expenses.

---

## Project Structure

```text
splitmate/
│
├── client/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── context/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── utils/
│
├── server/
│   ├── routes/
│   ├── middleware/
│   ├── controllers/
│   ├── services/
│   ├── prisma/
│   │   └── schema.prisma
│   └── utils/
│
├── docs/
│   ├── SCOPE.md
│   ├── DECISIONS.md
│   └── AI_USAGE.md
│
└── README.md
```

---

## Installation

### Clone Repository

```bash
git clone <repository-url>
cd splitmate
```

### Install Dependencies

```bash
npm install
```

Frontend:

```bash
cd client
npm install
```

Backend:

```bash
cd server
npm install
```

---

## Environment Variables

### Server

```env
DATABASE_URL=

JWT_SECRET=

PORT=5000

CLIENT_URL=http://localhost:5173
```

---

## Prisma Setup

Generate Prisma Client

```bash
npx prisma generate
```

Run Migrations

```bash
npx prisma migrate dev
```

Open Prisma Studio

```bash
npx prisma studio
```

---

## Running Locally

Backend

```bash
npm run server
```

Frontend

```bash
npm run client
```

Both

```bash
npm run dev
```

---

## Documentation

Additional project documentation:

### SCOPE.md

Contains:

* Feature scope
* Database schema
* CSV anomaly definitions

### DECISIONS.md

Contains:

* Architecture decisions
* Trade-off analysis
* Assumptions

### AI_USAGE.md

Contains:

* AI prompts used
* Incorrect AI outputs
* Validation process
* Corrections applied

---

## Future Improvements

* Email invitations
* Recurring expenses
* Mobile application
* Real-time updates via WebSockets
* OCR receipt scanning
* Expense categories and analytics

---

## Author

Kunal Dhangar

Computer Science Student

Built as part of a Software Engineering Assessment.
