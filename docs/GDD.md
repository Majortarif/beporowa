# বেপরোয়া (Beporowa): design document

Agreed in Step 1 on 2026-11-05. The owner chose the name বেপরোয়া ("reckless") over the first proposal, "Neon Borsha". Phase status is in the README.

## Pillars

1. Driving feel comes first.
2. Dhaka's chaos is the gameplay: jams, horns, floods, loadshedding.
3. Bangla is the game's main language, not a decoration.
4. Hand-painted identity.

**Core loop:** adda at a tea stall → mission or rumor by phone → race or pursuit → cash and reputation → garage → next rival.

**Art direction, রিকশা-পেইন্ট নিয়ন:** enamel colours (tomato, marigold, teal, parrot green, rani pink) falling onto wet roads. HUD and menus look like painted tin signboards. No cyan-magenta synthwave, no glass panels, no purple gradients. Hard offset shadows, never blur.

**Honesty rules:** do not claim "first Bangla racer", because Dhaka Racing and others already exist. Use "Bangla-first browser street racer". Target is AAA-*feel* through driving, animation and sound, not photorealism.

## City: বর্ষাবাদ (Borshabad), on the কাজলগঙ্গা river

| District | Gameplay signature |
|---|---|
| পুরানটোলা (old town) | Maze race, horn language, ফাঁক-ফোকর bonus, hiding in alleys |
| উড়ালগঞ্জ (flyovers) | Top speed, toll gates, drag, flyover loop |
| সুতোপাড়া (garment zone) | Truck traffic, shift-change crowds, delivery runs |
| ঝিলপাড় (lake) | Fog, bridges, reflections, drift |
| কাজলঘাট (river port) | River-dock race, cranes, launches |
| কাচনগর (glass towers) | Wide roads, high-end rivals, heavy police presence |

**Vertical layer:** ছাদপাড়া, rooftops above পুরানটোলা.
**Landmarks:** ময়ূরপঙ্খী চত্বর (monument roundabout), জ্ঞানতোরণ (arch), ভাসা হাট (floating night market), ছাদ-দৌড় (rooftop drag), গোধূলি পাড় (sunset strip).
Phase 2 built পুরানটোলা and উড়ালগঞ্জ. Phase 4 added কাজলঘাট.

## Story

The player is a rookie from পুরানটোলা who enters **দ্য রিং** to pay off the debt on ওস্তাদ's garage. **বিশেষ ধাওয়া ইউনিট** under চিফ রেজওয়ান তালুকদার hunts street racers. আরজে টুনটুনি hosts "রেডিও ঝড়". Twist: the #1 rival জাহান was once ওস্তাদ's own apprentice.

| # | Rival | Tone | Car | AI style |
|---|---|---|---|---|
| ১০ | মিঠু "গলিবাজ" | ঢাকাইয়া | শালিক | Shortcuts, gap-cutter |
| ৯ | সাদিয়া "সুতো" | Standard | ফড়িং | Clean line, few mistakes |
| ৮ | বাদল "বর্ষা" | খুলনা flavour | ইলিশ | Rain and flood specialist |
| ৭ | জিসান "ধাক্কা" | রাজশাহী flavour | চিতল | Very polite words, rams anyway |
| ৬ | পাপড়ি "স্লিপ" | Standard | মাছরাঙা | Drift, corner speed |
| ৫ | তানভীর "কাচ" | Standard | শঙ্খচিল | Monster on straights, weak in lanes |
| ৪ | রুবেল "ক্রেন" | চট্টগ্রাম flavour | বাজপাখি | Blocker |
| ৩ | নীলা "কুয়াশা" | সিলেট flavour | custom শঙ্খচিল | Lights-off, traffic trickster |
| ২ | শাওন "মিটার" | ঢাকাইয়া | custom বাঘা | Last-lap pressure |
| ১ | জাহান "কালবৈশাখী" | Standard | বাঘা prototype | Adaptive: remembers your habits |

**Cars:** গলি class: বুলবুলি (starter), শালিক, ফড়িং. সড়ক class: ইলিশ, মাছরাঙা, চিতল. উড়াল class: বাজপাখি, শঙ্খচিল, বাঘা. Secret: রিকশা রকেট.

**হর্ন ভাষা v1:** one tap makes rickshaws and buses yield. Two taps provoke a rival. A long horn clears pedestrians. Three taps confuse police, with a cooldown.

## Decisions that changed the original brief

| Topic | Decision | Reason |
|---|---|---|
| "Speedbreaker", "Pursuit breaker" | **দম** (slow-mo), **ঝামেলা-ফাঁদ** | Both are familiar Need for Speed terms; in Bangla "স্পিড ব্রেকার" also means a road bump |
| Touch controls | Basic version in Phase 1 | The Netlify link must be testable on a phone |
| GSAP | Custom tween | Small job, no dependency or license question |
| Azaan | Off by default, only a clean CC0 or own recording | Synthesizing it would be disrespectful; never linked to gameplay |
| Pedestrians | Never hit, they always dodge | Respect; no gore or injury |
| Police | Fictional unit only | No real force names or uniforms |
| Start screen | "এই বেপরোয়াপনা শুধু গেমে, রাস্তায় না।" | The word is what Bangla news uses for deadly road accidents |
| Rain | Not in Phase 1, only a wet-look road | Weather belongs to Phase 6 |

Regional dialects: চট্টগ্রাম and সিলেট speech is far from standard Bangla, so lines stay lightly flavoured and tagged in `review-flags.json`. A native speaker must review them.

## Architecture

```text
Input (keyboard / gamepad / touch)
   │  Intent {throttle, brake, steer, handbrake, nitro, horn}
   ▼
Fixed 60 Hz sim: Vehicle → Rapier → Traffic / Police / Rival AI → Race rules
   │  Event bus (near-miss, crash, heat, lap)
   ├──▶ Audio, Radio, পোলাপান কমেন্ট, HUD, Save
   ▼
Render (rAF): interpolate → animation → camera → world streaming → post
   ▼
HTML/CSS overlay (all Bangla UI)
```

| System | Decision | Reason |
|---|---|---|
| Physics | Rapier compat build + own raycast vehicle | Scales better than cannon-es; no extra Vite setup |
| Traffic | Near cars get kinematic colliders; far cars are lane-graph data in typed arrays | Full physics on every car would use up the CPU |
| AI | Personality-based state machines; distant agents update less often | Fair and cheap |
| City | Hand-made district blueprints + procedural fill, chunk streaming, instancing | Landmarks stay unique at low cost |
| Post | pmndrs `postprocessing` | Merges effects into one pass |
| Bangla UI | HUD and menus in DOM; in-world signs Canvas 2D → texture atlas | The browser shapes conjuncts; never SDF or bitmap |
| Bangla rules | No `letter-spacing`; subtitles reveal word by word; game waits for fonts | Letter-spacing breaks the matra; letter-by-letter can split conjuncts |
| Numbers and dates | `Intl.NumberFormat('bn-BD')`; own বঙ্গাব্দ utility | `Intl` has no Bengali calendar |
| Voice | Subtitles first; TTS optional, off by default; `dialogue.json` + voice file slots | Own recordings can be dropped in later |
| Save | IndexedDB with schema versions from Phase 5; settings in localStorage | Safe migrations |

## Performance budget (targets)

| | Low (phone) | Medium (integrated GPU) | High | Ultra |
|---|---|---|---|---|
| FPS | 30 | 60 | 60 | 60 |
| Render scale | 0.6–0.75 | ~0.85 | 1.0 | 1.0+ |
| Draw calls | ≤120 | ≤250 | ≤400 | ≤600 |
| Triangles | 150k | 500k | 1M | 2M |
| Traffic (near / total) | 6 / 30 | 12 / 80 | 20 / 150 | 30 / 250 |
| Pedestrians | 20 | 60 | 120 | 200 |
| Texture memory | 128 MB | 256 MB | 512 MB | 1 GB |
| Post | Tonemap, cheap bloom | + wet reflection | + SSAO, motion blur | + SSR, DOF, volumetric |

Download targets: initial ≤ 3 MB gzip, fonts ≤ 400 KB. 60 FPS frame: sim 3, AI 2, render JS 4, GPU 6 ms.

## Risks

| Risk | Level | Mitigation |
|---|---|---|
| Scope is huge | High | Phase 1–4 + 2 districts is the portfolio cut-line |
| Driving not fun | High | No Phase 2 until the owner says it is fun; tuning panel |
| Slow on phones | High | Low preset from day one; full post will not run on phones |
| Procedural art looks cheap | High | Rickshaw-paint generators, hero landmarks, CC0 only where needed |
| Bangla TTS | High | Voices vary by device; no regional accents; subtitles stay primary |
| Multiplayer | High | Netlify cannot host WebSockets; ghosts and leaderboards first |
| Dialect mistakes | Medium | Light flavour, tags, native review |
| Bangla rendering | Medium | Conjunct test signs, font gate, three screen widths |
| Legal and IP | Medium | No real brand silhouettes; `CREDITS.md` lists every asset |
| City streaming hitches | Medium | Chunk budget, pooling, instancing |
| WebGPU later | Low | Custom shaders need porting to TSL, so the render layer stays separate |

## Phase 2 as built

- The map is hand-authored in `src/world/city/city-map.ts`. +X is east, +Z is south. Traffic drives on the left, and the roundabout runs clockwise.
- Ground roads all lie on one flat floor collider. Only the flyover and ramps have their own surfaces.
- A ramp's road carries straight on from its foot and curves back into town, so nobody needs a U-turn to get on.
- Traffic is a bubble around the player, in typed arrays, using the Intelligent Driver Model. Only near vehicles have colliders.
- Crashes resolve as an inelastic bump between masses, and a crash speed limit keeps rickshaws and bikes from being thrown.
- Pedestrians have no colliders. A hard rule pushes them out of the car's footprint every frame.
- Horn language v1: one tap yields, long clears people, two taps honk back.
- Chunk streaming is deferred: the two-district map stays loaded, with buildings merged by map cell for frustum culling.

## Phase 3 as built

- `src/config/police-tuning.ts` holds every number for pursuits. `HeatSystem` holds only the rules (stars, cooldown, arrest), with no driving or drawing in it, so it is tested alone.
- Police cars are the player's own `VehicleController` with a `PoliceDriver` in place of input. That costs about 0.05 ms per car per step and makes contact honest. Cars are pooled and disabled when off duty.
- Units use the road graph when out of sight or on another level, and drive straight to a slot around the player when in plain sight. When the player has all but stopped, every unit pulls up in a ring rather than shoving the car out of the arrest radius.
- All cars share `GROUP_TRAFFIC`, which wheel rays and sight rays ignore. So cars never stand on each other, and only walls and roofs block a unit's view.
- A PIT is a yaw impulse and a short loss of rear grip, given only on a real rear-corner overlap.
- The helicopter and drone have no physics. Roofs block them through a real ray, and they can be outrun.
- Garages and traps reserve their ground in the occupancy grid before buildings are placed.
- Trap pieces have no colliders while standing. On trigger they borrow dynamic bodies from a fixed pool.
- দম changes `GameLoop.timeScale`, so physics steps come less often and rendering interpolates between them. Camera and HUD run on real time.
- Decision: a trap can be sprung with no pursuit running, and pays points, because clipping one should always do something.
- Decision: adaptive difficulty moves units and speed within a narrow band (0.82 to 1.22) and is stored in settings.

## Phase 4 as built

- `src/config/race-events.ts`, `rivals.ts` and `race-tuning.ts` hold every event, rival and number. `RaceSession` holds the rules and has no drawing in it, so whole races run headless in tests.
- A `RaceCourse` is built from map nodes: rounded at junctions, on the left carriageway of wide roads (which also misses the flyover pillars), and around roundabouts the way traffic goes. Progress is a running total of small moves along the line, so a loop needs no lap counter and a shortcut gets no credit.
- Rivals use the same `VehicleController` and driver as the police. Personality is only a set of traits. Rubber-banding is capped at +14% and -20% of power, and fades to nothing between 78% and 94% of the race.
- Memory is a small record saved with the career: passes by side, first nitro, crash rate and win margin. Every rival shifts slightly with your record, and adaptive ones change their plan.
- Drag races switch the gearbox to manual, with a torque band and a hard limit at the top of each gear. Elsewhere it stays automatic.
- Takedowns use real contact, and damage comes from closing speed, more from the side.
- The river port opened two barricaded roads. It reserves its ground before buildings are placed.
- Decision: the crowd and rivals are drawn but do not act out gestures yet. That depends on the character work planned for later phases.
- Decision: a board switch opens all races, so the work can be seen without playing twenty events.

## Phase 5 as built

- `src/config/cars.ts`, `progression.ts` and `achievements.ts` hold every car, price, rate and achievement. `src/progression/economy.ts` holds the rules with no screens or storage in it, so they are tested directly.
- Stats are shares of a stock বুলবুলি, and they reach the car through its `VehicleProfile`. The rig and physics are the same for every car. Only numbers and looks change.
- `src/vehicle/car-models.ts` builds any car. বুলবুলি keeps its own body, the others share the rivals' lofting kit with a side-projected texture, and রিকশা রকেট is its own model. Parts sharing a material merge into one mesh, so a car costs about twelve draw calls plus its wheels.
- `src/render/livery-painter.ts` paints from a small description, onto canvases that stay Canvas 2D, so Bangla shaping keeps working and a repaint is instant. The car's right side reads the texture flipped, so pictures are never backwards.
- The garage is a real building at the start of the map. The parked state keeps the city running and shows a `StopCamera` orbit. The title screen uses the same view, which is the "live 3D garage" the brief asked for.
- Saves moved to IndexedDB with `SAVE_SCHEMA`, falling back to localStorage and then memory. `migrateSave` brings a Phase 4 save forward and pays it once for what it had earned.
- Rivals follow the player's car through `rivalScale` and `scaleToCar`: 60% the car, 40% what their rank expects, and always above the Phase 4 floor. Only their machine changes, never their habits.
- Rumours were written from each rival's real traits, so they are true advice.
- Decision: a cup of tea repairs only up to 70%, so the garage's paid repair still matters.
- Decision: NPCs live in the menu rather than as figures in the world. Walking characters belong with the character work in a later phase.
- Decision: the name খোকন ভাই replaced an earlier nickname that could read as a comment on skin colour.

## Phase 6 as built

- `AtmosphereDirector` decides the hour, the weather, wetness, water, lightning and blackouts, and draws nothing, so it is tested headless. `AtmosphereRuntime` carries its numbers into the world each frame. The night key is exactly the look from Phases 1 to 5, and the test road has no director, so it never changes.
- Shared shader values live in `src/render/atmosphere-uniforms.ts`. One change there reaches every material. Glow built into models, painted boards, windows, lamps, people and the river all follow it, with no per-material work.
- Four environment maps are baked once at start, and swapped between keys of the day. Re-baking on the fly would hitch.
- Grip and water are real physics. `PhysicsWorld.weatherGrip` scales every tyre, `floodAt` adds a surface for water with speed-squared drag and aquaplaning, and AI drivers read the same grip when choosing corner speeds, so the weather is fair to everybody.
- A blackout is a circle that grows in the shader, so it needs no per-building data and costs nothing extra.
- Rain, splashes, mist and birds are placed in vertex shaders, wrapped around the camera. The CPU only passes a clock.
- The replay records at 15 Hz into typed arrays made once, including all traffic. Playback writes the old positions into the same objects the renderers read, after setting the real ones aside, and puts them back after. So no renderer knows about replays, except that traffic skips live crash debris.
- Photo mode's depth of field is created the first time it is asked for, because it needs a depth texture and nobody driving should pay for that.
- Music is two parts: pure pattern generation and mix choice, which are tested, and a Web Audio engine that plays them with a look-ahead scheduler. Moods change on the bar line.
- The radio is a pure scheduler with priorities and cooldowns. Words can come from a recording, the browser's voice or just the screen.
- Decision: no synthesised azaan. It would be disrespectful, so it waits for a real recording used with permission.
- Decision: fog is faked with sheets and light shafts, and SSAO and motion blur are left out, to stay inside the performance budget on a mid-range laptop.
- Decision: lightning is turned right down under Reduce Motion, since flashes can be a real problem for some players.

## Phase 7 as built

- Ghosts are 12 samples a second of position, rotation and progress, sampled at exact moments by blending the physics steps either side, and drawn with Catmull-Rom between samples. Packed as Int16 at a tenth of a metre, a two-minute ghost is about 40 KB of JSON. The best ghost per event lives in the same IndexedDB as the save, beside it.
- The challenge calendar is pure: the day on Bangladesh time picks a shuffled cycle in which every daily challenge comes round once, never the same two days running. So every player sees the same challenge with no server, and the leaderboard can check that a board key names today's or yesterday's real challenge.
- Seasons are the six ঋতু from the Bangla calendar module written in Phase 1. A season id is the Bangla year and the ঋতু, so it changes on its own. Unlocks are kept apart from the season, so they survive it.
- Leaderboard rules live in one module shared by the Netlify Function, the Vite dev server and the tests. A store is handed in: Netlify Blobs in production, a Map elsewhere. A time board needs the run's ghost, and checks its time, length, start point and top speed. The floor for any time is 80% of the straight lines between the event's nodes, driven at the fastest average any car could hold.
- The friends relay forwards messages and keeps no world: every client drives its own car and owns its own physics, so the relay needs no game code and no anti-cheat for collisions. Friends' cars have no bodies for the same reason. Colyseus was considered and left out, because there is no shared state for it to synchronise; plain `ws` keeps the relay to one file.
- The live AI lines run only on the server, through the Anthropic SDK, with the key from the environment. The game asks for one line per moment ahead of time and keeps it ready, so a taunt never waits on the network. A refusal, an error, a timeout or a line that fails the checks all fall back to the written lines.
- Decision: challenge runs are alone and under a fixed sky, so times are fair to compare, and they never change the Ring ladder, so the challenges cannot be farmed for rank.
- Decision: menus keep the polite আপনি of the earlier phases; characters keep their own voices.
- Decision: Rooftop Stunt Park and the crew and turf system are left for later. Each needs new geometry or a new layer of rules, and both would have been thin if rushed.

## Phases

1. **Driving feel + Bangla foundation** (done).
2. **Living city** (done): two districts, lane traffic, pedestrians, lights, minimap, GPS, jams, horn language v1.
3. **Police + heat** (done): heat 1–5, chase, box-in, PIT, roadblocks, spikes, helicopter, drone, hiding spots, ঝামেলা-ফাঁদ, দম, Bangla radio, adaptive difficulty.
4. **Races + rival ranking** (done): twelve event kinds, ten rival personalities, fair rubber-banding, rival memory, Top 10 board, intros, boss race, কাজলঘাট river port.
5. **Cars, tuning, progression** (done): 10 cars, garage, রিকশা আর্ট livery editor, parts, dyno, cash, levels, achievements, daily rewards, adda mode, tea stalls.
6. **Polish** (done): day and night, weather, waterlogging, wet neon, faked volumetric fog, lens flare, heat haze, photo mode, replays, adaptive music, Bangla DJ radio.
7. **Modern extras** (done): ghosts and ghost battles, daily and weekly চ্যালেঞ্জ with a word of the day, a free season pass by the Bangla ঋতু, online leaderboards, friend races and spectating over a relay, tilt and slider steering, gamepad rumble, key remapping, colour-vision sets, subtitle sizes, high contrast, and optional AI-written lines.
