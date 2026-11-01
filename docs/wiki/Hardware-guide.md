# Practical Linux and Windows hardware

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)

![Workflow diagram for hardware guide.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/system.svg)

**Quick path:** Enter the actual recording workload → budget storage and power → measure the intended host. Hardware presets are planning candidates.

[Start locally](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) · [Linux](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Linux-setup) · [Windows](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Windows-setup) · [GPUs](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning) · [Resource controls](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls)

This is an engineering sizing proposal, checked against manufacturer documentation on **October 27, 2026**. It is not a benchmark, purchase order or 100-camera qualification. The app's **System** workspace makes the assumptions editable and exports local limits; it does not provision hardware or storage.

![Actual System workspace; all capacity and power figures are entered assumptions and calculations.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/system-setup.webp)

## Recommended approach

Separate long-term encoded recording from AI sampling. Keep the recorder dependable while inference work can be stopped, upgraded or moved to another local machine. A CPU-only review/evaluation pilot can run now. Live ingest/recording and an accelerated GPU service still need implementation and acceptance.

| Build | CPU / RAM planning suggestion | Storage suggestion | GPU and power suggestion |
| --- | --- | --- | --- |
| Existing-machine qualification | Keep the current workstation first; 8+ modern cores and 32–64 GB RAM are a development starting point | 1 TB OS SSD; separate 2 TB working SSD and a few approved recordings | Use an existing compatible GPU for future qualification; current inference remains CPU |
| Dedicated recording/storage candidate | Ryzen 9 9950X class, **128 GB RAM**, motherboard with validated HBA/NIC lane layout | **12 active 24 TB CMR HDDs**, two-parity layout; 1–2 TB boot SSD; mirrored enterprise SSD metadata/work tier | Integrated display or modest display GPU; separate AI host; compatible **1000 W** PSU candidate after rail/startup review |
| Combined expandable workstation candidate | Threadripper 9960X class, **128–256 GB ECC RDIMM** on a compatible TRX50 board | Same disk calculation, with direct HBA/backplane access and dedicated boot/working SSDs | Qualify an already-owned RTX 5080 or a measured-fit RTX PRO candidate; the 350 W CPU + 5080 + 12-HDD example needs **1,560 W PSU arithmetic at 75% loading**, before any extra boost allowance |
| Split recording candidate | Two independent machines; initially 16-core class, 64–128 GB RAM each, measured per-node load | **8 active 24 TB, two-parity HDDs per node**, each assigned 50 cameras | Separate analytics host(s) sized from measurements; failure of one node does not silently move its cameras to the other |

These CPU/RAM amounts are budget suggestions, not demonstrated camera capacities. The Ryzen 9 9950X has 16 cores/32 threads and a 170 W default TDP [C1]. Threadripper 9960X has 24 cores/48 threads and a 350 W default TDP; its platform offers more expansion options [C2]. TDP is not a maximum wall or boost-power measurement. Check the exact board's RAM QVL, supported ECC mode, cooling, physical slots and shared PCIe lanes before buying. AM5 UDIMMs and Threadripper RDIMMs are not interchangeable.

For a new purchase, I would begin with the **separate recording/storage candidate**, retain an existing GPU workstation for qualification, and expand compute only after sustained measurements. Do not buy GPUs from an assumed cameras-per-card ratio.

## Recording capacity, with all deductions visible

Example assumptions: continuous recording; average **4 Mbit/s per camera**; **100 cameras**; 10% recording/container allowance; 5% filesystem/array allowance; 20% free-space reserve. Decimal TB = 10¹² bytes. GiB and MiB are binary units.

| Retention | Encoded video alone | Including 10% recording allowance | Required protected capacity before 5% filesystem allowance and 20% free reserve |
| --- | ---: | ---: | ---: |
| 7 days | 30.24 TB | 33.264 TB | 43.77 TB |
| 14 days | 60.48 TB | 66.528 TB | 87.54 TB |
| 30 days | 129.60 TB | 142.560 TB | 187.58 TB |
| 30 days at 8 Mbit/s instead | 259.20 TB | 285.120 TB | 375.16 TB |

The 12 × 24 TB example is **288 TB raw → 240 TB after two parity drives → 228 TB after the 5% allowance → 182.4 TB recording budget**. At 4.752 TB/day including recording overhead, that is approximately **38.4 calculated days**. It does not mean those drives, the controller or the program have actually recorded 100 cameras.

Each proposed split node has 192 TB raw → 144 TB after parity → 109.44 TB recording budget. At 50 cameras with the same assumptions, that is about **46.1 calculated days per node**. A hot/cold spare adds cost and a physical drive but contributes **zero recording capacity** until it replaces a failed member. Keep at least a compatible cold spare; choose hot-spare policy with the storage implementation.

Measure real VBR averages for retention and peak rates for network/recording acceptance. Audio, extra streams, indexing, exports, rebuilds and growth can change demand. Motion-only retention must be qualified separately; do not assume a low duty cycle. The 400 Mbit/s encoded payload is about 50 MB/s before the 10% recording allowance, or 55 MB/s with it. Network protocol overhead, playback, rebuilds and other traffic are additional.

## HDD shortlist for the recording tier

| Candidate | Verified manufacturer facts | Why it is a candidate / what to check |
| --- | --- | --- |
| **Seagate SkyHawk AI 24 TB, ST24000VE002** | SATA, CMR, RV sensors, 550 TB/year workload rating, 5-year limited warranty [D1] | Direct surveillance-oriented candidate for the example; confirm exact model/firmware, seller warranty and HBA/backplane compatibility |
| **WD Purple Pro 24 TB, WD241PURP** | SATA, CMR, RV sensors, up to 550 TB/year, 5-year limited warranty [D2] | Comparable surveillance candidate; do not substitute a different Purple SKU without checking its rating |
| **WD Purple Pro 26 TB, WD260PURP** | SATA, CMR, up to 550 TB/year [D2] | More retention per bay; recalculate from 26 TB and validate controller support |

These are a short list for this workload, not a claim that one model is universally best. Avoid mixing capacities/performance classes casually, and verify recording technology on the exact SKU. Manufacturer “camera support” and AI-stream labels describe their test conditions; they do not qualify this application.

The default workload estimate is about **260.2 TB/year per HDD including a 50% read allowance**, assuming ideal sequential full-stripe writes across ten data-equivalent drives. It excludes rebuilds, scrubs and small-write amplification. Annual HDD workload includes transfers, not just retained capacity; it is not SSD TBW or a promise of failure-free service. Monitor actual SMART/controller health and traffic outside this prototype.

## SSD shortlist and roles

| Role | Candidate | Rationale and boundary |
| --- | --- | --- |
| Boot / app / logs | **Micron 7450 NVMe server-boot M.2 variant**, around 960 GB or more, exact SKU selected for the board | Micron identifies an M.2 2280 model with power-loss protection [S1]. Check capacity, length, thermal clearance and firmware; the family includes other form factors |
| Metadata / indexes / review database / bounded work area | **2 × Kingston DC600M 3.84 TB, SEDC600M/3840G**, mirrored where the selected storage stack supports it | SATA 2.5-inch enterprise TLC with hardware PLP; 7,008 TBW / 1 DWPD over five years for this capacity [S2]. This project does not yet implement a production review database |
| Larger enterprise work tier | DC600M 7.68 TB or a qualified enterprise NVMe with PLP | Size from measured write volume and model/trace working sets, not peak sequential marketing speed |

Keep the OS and the recording volume separate. A 1–2 TB OS SSD provides room for tools, packages and model work; it is not a footage-retention allocation. Avoid using a small consumer SSD as an unrestricted write-through landing tier for all 100 streams: the illustrated stream workload is multiple TB/day. Compare the exact SSD's endurance and warranty workload with measured writes. PLP complements a UPS; it does not replace array consistency, tested recovery or backups.

## Power, cooling and connectivity

- **PSU candidates:** Corsair **RM1000x CP-9020271** for an appropriate ATX recording build; **HX1500i CP-9020309** for the illustrated Ryzen + RTX 5080 combination. Vendor pages identify ATX 3.1 models [P1, P2]. The 350 W Threadripper example reaches 1,170 W simultaneous allowance and 1,560 W at 75% loading, so the 1500 W candidate does not meet that planning margin. Choose a validated higher-output arrangement or separate the GPU host. Exact regional SKU, connectors, chassis fit and warranty must be checked. A rack chassis may require its own approved redundant power modules instead of an ATX PSU.
- **Startup arithmetic:** entered CPU allowance 170 W + other components 100 W + 12 × assumed 30 W/HDD = 630 W; 630/0.75 = 840 W PSU arithmetic. Add a same-host reference RTX 5080 allowance of 360 W and this becomes 990/0.75 = 1,320 W. These assumptions are intentionally editable. Seagate lists a *typical* 12 V startup current of 2 A for the 24 TB model [D1]; 30 W is a planning allowance, not a verified worst-case per-drive ceiling. Validate all rails, boost loads and transients.
- **Native power cables:** use the PSU maker's approved cables and a validated backplane/harness. Check connector count and per-harness current; never assume one consumer SATA chain can start a whole disk array. Fully seat GPU power connectors and observe the card/cable supplier's bend/clearance guidance. Modular PSU cables are not universally interchangeable.
- **Cooling/chassis:** choose a ventilated 12/16-bay chassis with sufficient drive spacing, filters, service access and controlled fan monitoring. Include HBA and SSD airflow as well as CPU/GPU heat. Verify temperatures under a sustained mixed load; desktop idle readings are not acceptance.
- **Network:** 2.5 GbE is a sensible initial recorder-facing port class for the example; prefer a **10 GbE uplink/storage path** for playback, transfers and growth. Budget camera PoE separately from host power. Use camera substreams for analysis only after codec, geometry and quality checks.
- **UPS:** size from measured **AC watts** for the host, disk enclosure, network and PoE equipment; VA alone is insufficient. Test graceful shutdown and recovery with the chosen OS/array. Redundant PSUs need independent suitable power paths; redundancy is not the sum of two nameplate ratings.

## Operating-system storage choices

On Linux, a qualified OpenZFS RAIDZ2 arrangement with a direct HBA is a reasonable candidate, or a deliberately managed alternative such as RAID6 plus a supported filesystem. On Windows, use a controller/storage stack with explicit Windows driver, cache protection and recovery support; validated hardware RAID6 plus NTFS is one candidate. Do not assume Windows client Storage Spaces exposes identical dual-parity behavior to RAIDZ2 or server-only features. These are provisioning decisions; **the app creates no RAID set and formats no disk**.

Back up configuration, keys and important reviewed evidence to independent storage with restore tests. Redundancy reduces some disk-failure risk; it does not protect against deletion, corruption, theft, ransomware or an enclosure failure.

## Manufacturer sources

The text above summarizes only the relevant specifications; final part selection requires the exact current data sheet and compatibility lists. No live prices, availability or comparative reliability ranking is asserted.

- **D1:** [Seagate SkyHawk AI data sheet](https://www.seagate.com/content/dam/seagate/en/content-fragments/products/datasheets/skyhawk-ai/skyhawk-ai-DS1960-15C-2310US-en_US.pdf), model table and power/workload notes.
- **D2:** [WD Purple Pro data sheet](https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/product/internal-drives/wd-purple-pro-hdd/product-brief-wd-purple-pro-sata-hdd.pdf).
- **S1:** [Micron 7450 family and server-boot M.2 PLP description](https://www.micron.com/products/storage/ssd/data-center-ssd/7450-ssd).
- **S2:** [Kingston DC600M data sheet](https://www.kingston.com/datasheets/sedc600m_us.pdf).
- **C1:** [AMD Ryzen 9 9950X](https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html).
- **C2:** [AMD Threadripper 9960X](https://www.amd.com/en/products/processors/ryzen-threadripper/9000-series/amd-ryzen-threadripper-9960x.html), [platform expansion overview](https://www.amd.com/en/blogs/2025/designed-to-create-built-to-inspire-amd-introduces-new.html).
- **P1:** [Corsair RM1000x CP-9020271-NA](https://www.corsair.com/us/en/p/psu/cp-9020271-na/rmx-series-rm1000x-fully-modular-power-supply-cp-9020271-na).
- **P2:** [Corsair HX1500i CP-9020309-NA](https://www.corsair.com/us/en/p/psu/cp-9020309-na/hx1500i-fully-modular-ultra-low-noise-platinum-atx-1500-watt-pc-power-supply-cp-9020309-na).
- GPU specifications and the acceleration boundary are in [GPU planning](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/hardware-guide.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
