// The review path for reported exhibits, run on the machine itself:
//
//   flyctl ssh console -a <app> -C "node src/review.ts list"
//   flyctl ssh console -a <app> -C "node src/review.ts hide 42"
//
// `list` shows every reported exhibit, most-reported first, with its label,
// story and the reasons given. `hide` takes one out of every public view but
// keeps it for a second look; `restore` puts it back; `remove` deletes it
// outright, as a withdrawal would. Open museum tabs hear about all three
// within a couple of seconds (src/server.ts reads the events this writes).
import { reportedExhibits, setExhibitHidden, withdrawExhibit } from "./db.ts";
import { accession } from "./museum.ts";

const [command, arg] = process.argv.slice(2);
const id = Number(arg);

if (command === "list") {
  const rows = reportedExhibits();
  if (rows.length === 0) console.log("No reported exhibits.");
  for (const r of rows) {
    console.log(`${accession(r.id)}${r.hidden ? " (hidden)" : ""}: ${r.reports} report(s): ${r.reasons}`);
    console.log(`  label: ${JSON.stringify(r.label)}`);
    console.log(`  story: ${JSON.stringify(r.story)}`);
  }
} else if (command === "hide" && Number.isInteger(id)) {
  console.log(setExhibitHidden(id, true) ? `${accession(id)} hidden.` : "Nothing to hide.");
} else if (command === "restore" && Number.isInteger(id)) {
  console.log(setExhibitHidden(id, false) ? `${accession(id)} restored.` : "Nothing to restore.");
} else if (command === "remove" && Number.isInteger(id)) {
  console.log(withdrawExhibit(id, null) ? `${accession(id)} removed.` : "No such exhibit.");
} else {
  console.log("usage: node src/review.ts list | hide <id> | restore <id> | remove <id>");
  process.exitCode = 1;
}
