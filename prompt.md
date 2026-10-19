# The datacentre is earned, the factory is lived with, and the world expands

## What we want

Right now a Datacentre on Earth costs 10 stone and 6 timber, so most rooms have one within a few minutes and the bot builds it third. It should instead be **earned through a visible supply chain and staked-out ground**: raw stock, then manufactured parts, then a claim, then the build.

Give Plenty a clear, satisfying factory progression: gather raw resources, process them into parts, claim land, build a datacentre, automate supply, then improve the network. The datacentre is an earned milestone with a short, understandable supply chain, and it must still be reachable quickly using cheap, inefficient, and environmentally destructive methods.

Reward those shortcuts immediately: faster harvesting, cheaper construction, more output, and earlier compute. Their consequences emerge through continued play: wasted deposits, damaged land, thirsty cooling, heat, overloaded supply lines, and an energy reserve that runs out sooner.

Against all of that, we are vastly expanding the world and overhauling the user experience:
1. **A Narrative-Driven Tutorial & Intro Cutscene:** Instead of throwing players straight into the sandbox, the game now begins with a cinematic tutorial stage that establishes the lore and stakes.
2. **Larger, Varied Maps:** We are significantly expanding map dimensions and introducing terrain variance (elevation, water, rough ground) that affects movement and logistics.
3. **Comprehensive UI & Quality of Life (QoL) Overhaul:** The UI must be upgraded to support scrollable information screens, replacing hidden keyboard shortcuts with clickable UI elements, and finally making the game fully playable on mobile devices.

This brief is the master version. It introduces sweeping changes to world generation, narrative state, and UI architecture. It is designed to be implemented over a multi-day cycle.

## Inspiration and scale

Read these references for design principles, then adapt them to Plenty's cooperative sessions:
- **Satisfactory / Factorio:** Connect resource extraction, manufacturing, and infrastructure so each new capability creates an understandable demand on the previous stage. Use explicit trade-offs between production speed, resource efficiency, and pollution.
- **RimWorld / Dwarf Fortress (Lite):** For terrain generation. The world should feel physically distinct (hills, rivers) altering how players route their factories.

Keep the implementation compact but robust: a small recipe set, simple grid connections, and a state-machine driven tutorial. No vehicle simulation or complex fluid physics required.

## The Story and the Narrative Tutorial

Instead of starting blindly on Earth, players now start in **Stage 0: The Prologue**. This stage serves as both an immersive cinematic intro and a mechanical tutorial.

**The Lore:** 
Players are contracted engineers for "The Cooperative." The solar system's interstellar compute grid has collapsed, threatening to plunge human colonies into the dark ages. The Cooperative's mandate is to reboot dormant infrastructure on abandoned worlds at any cost.

**The Cinematic Intro Cutscene:**
Before players gain control, trigger an engine-rendered cutscene using the game's existing camera and sprite system:
- **The Visuals:** The camera slowly pans across a heavily overgrown, degraded server farm. A Cooperative drop-pod (or shuttle) lands, clearing dust and debris.
- **The Arrival:** The player sprites step out of the pod. A holographic projection of "Commander Vane" appears above a portable comms relay.
- **The Dialogue:** Vane delivers the briefing via a persistent, stylised dialog box: *"The grid is down. Billions are disconnected. We need compute power online yesterday. Clear the brush, establish a perimeter, and get a factory running."*
- **The Handoff:** The hologram fades, the camera snaps to the player, and UI controls fade in. 

**The Tutorial Mechanics:**
The Prologue is a guided, state-driven stage using a narrative log and Commander Vane's comms to introduce mechanics sequentially:
- **Phase 1 (Arrival):** The player is restricted to gathering ore and timber to "clear the landing zone." 
- **Phase 2 (Establishment):** Once X resources are gathered, Vane prompts the construction of basic housing and power to support a forward operating base.
- **Phase 3 (Industry):** The Factory is unlocked. The narrative introduces the recipe system.
- **Phase 4 (Expansion):** The player is taught to claim land and build the first Datacentre.
- **Transition:** Upon completing the first automated supply loop, Vane congratulates the team. The Prologue ends, saving the narrative state, and transitions to the true Stage 1 (Earth) with full sandbox freedom.
- **Implementation:** Use a deterministic state machine in `shared/tutorial.ts` that listens to the ledger and inventory. Triggers must sync to the client via state updates.

## The World: Larger Maps and Varied Terrain

To accommodate supply chains and claims, the world must physically expand.
- **Larger Maps:** Increase the map bounds generation by 2x to 4x the current area (e.g., 64x64 or 128x128). Adjust camera clamping accordingly.
- **Terrain Variance:** Add a `terrain` layer to the grid matrix in `shared/gen.ts`. Implement at least three terrain types:
  - **Plains/Clear:** Standard movement, standard build costs.
  - **Rough/Forest:** Slower movement (e.g., 0.5x speed). Harvesting local resources can clear it into Plains.
  - **Water/Impassable:** Blocks movement and building unless a Bridge/Path is built over it. Serves as the source for the coolant mechanic.
  - **High Ground:** Blocks direct building; requires specific path routing to traverse.
- **Consequences:** Layouts and pathing must now respect geography. A cheap travel path might route *around* a forest, taking longer, while an expensive path cuts straight through it, destroying the natural terrain permanently.

## The progression on every world

1. **Survey and gather.** Show nearest deposits. Hand harvesting always works. On Earth the player harvests **metal ore**.
2. **Establish workers and power.** Build basic housing and a cheap power source. 
3. **Manufacture parts.** Add a **Factory** that turns raw inventory into **manufactured goods**: at minimum **wire** (from metal) and one more part (structural frame). It requires zero compute, but needs power and workers.
4. **Claim and build.** Claim a small plot (e.g., 4x4) with a new command, then build a Datacentre inside it.
5. **Automate the supply.** Compute enables Harvesters. Connect output to factories with belts, bring coolant through pipes.
6. **Optimise or rush onward.** A hurried setup consumes more stock per useful result. A carefully planned setup delivers more useful production from finite inputs. 

## Recipes and manufacturing

Use a small explicit recipe table in `shared/content.ts`. 

| Recipe | Quick production | Efficient production |
| --- | --- | --- |
| Wire | 3 mineral -> 2 wire in 1 batch interval | 3 mineral -> 3 wire in 2 intervals |
| Frame | 4 mineral + 3 matter -> 1 frame in 1 interval | 3 mineral + 2 matter -> 1 frame in 2 intervals |
| Efficiency kit | 2 wire + 1 frame -> 1 kit | Same recipe; a deliberate investment |

Factories have a selected recipe, visible input/output buffers, and batch progress. 

## Simple travel, electricity, water and conveyor mechanisms

Layout must affect the setup, and must navigate the new terrain variances.
- **Travel lines:** Paths give movement bonuses and traverse rough terrain/water.
- **Electricity:** Cables connect generators to consumers. 
- **Water/coolant:** An intake beside a water terrain tile feeds a bounded tank and connected pipes.
- **Conveyor belts:** Directed segments transfer whole units of goods between buffers.

## Claims, permissions and cooperation

Add a claim command for a small plot. The server refuses other players' construction or demolition inside it. Claims never block walking, hand harvesting, or access to deposits. Write the ownership rule down in `docs/DECISIONS.md`.

## Feedback, Quality of Life, and Player Experience

The current game heavily relies on hidden keyboard shortcuts and fixed-size UI panels. We are overhauling this to make information readable and the game playable across all devices.

- **Scrollable Information Screens:** All UI panels (the Cooperative memo, the stockpile panel, inspect panels `I`, and goal checklists) must now feature styled, native scrollbars (`overflow-y: auto`). Content must never clip or become hidden off-screen as factories grow or when viewed on smaller monitors.
- **Mobile & Touch Playability:** The game currently renders on a phone but isn't playable. Implement touch-friendly UI overlays:
  - A visual "Action Bar" containing buttons for actions previously hidden behind hotkeys: Inspect (`I`), Demolish (`X`), Name Place (`N`), Survey (`V`), Photo (`P`), and Emotes (`Shift+1-6`).
  - A virtual d-pad or tap-to-move implementation for mobile users.
- **Zoom UI Controls:** Add explicit `+` (Zoom In), `-` (Zoom Out), and `Reset` buttons to the HUD. Hook these buttons into the rendering scale, clamping the zoom levels appropriately, and persisting the zoom state in local storage.
- **Inspect Panels:** Show throughput, expected inputs, power draw, coolant use, and plain-language idle reasons.
- **Server Logging:** Every claim, build, and recipe change is logged on the server.

## Rules that still hold

Read the "What the game must never do" and "What a change must not break" sections of `CLAUDE.md`.
- **The server decides.** Validation happens in `shared/sim.ts`.
- **Data Migration:** This changes the wire format and saved state. Persist terrain grids, batch progress, pipes, goods, and claims. Bump `PROTOCOL_VERSION` and add a migration in `server/store.ts`.

## Implementation and acceptance

Implement over 7 days in manageable steps: 
1. Map expansion & Terrain generation.
2. The UI & QoL overhaul (Scrollable panels, Zoom controls, Mobile Action Bar).
3. Goods, recipes, and the factory bootstrap chain.
4. Claims and cooperative permissions.
5. The narrative Tutorial Prologue (including the in-engine cutscene) and state machine.
6. Networks (belts, cables, pipes).

Update `scripts/playbot.ts` so the bot follows the new order. 

Add tests in `spec/sim.test.ts` for each of these:
- A datacentre is refused without goods or outside a claim.
- The tutorial state machine correctly triggers the cutscene and transitions phases based on inventory thresholds.
- Terrain movement penalties apply correctly to players and bots.
- Pathfinding (bots) successfully routes around or bridges over impassable terrain.
- Recipes consume correct inputs and cannot duplicate work through reconnecting.

Update the player guide in `README.md` for the new progression, tutorial, UI controls, mobile playability, and terrain features. Document building/recipe/network tables in `docs/DESIGN.md`. Delete this `prompt.md` in the implementation agent's last commit.