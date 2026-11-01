// Import on the Vite fixture page; exercises the production route tree.
import { mountUiAudit } from "./ui-audit.browser";
import { radioProgrammesQuery } from "../src/client/api/radio";
import { radioNow, type RadioGuide } from "../src/shared/radio";

export async function runRadioGuidesRegression(keepMounted = false) {
  const audit = await mountUiAudit();
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 200));
  const overflow = () => document.documentElement.scrollWidth > innerWidth;
  try {
    await audit.go('/radio');
    assert(document.querySelector('[aria-label="Genre"]'), 'Missing genre filter');
    const row = () => document.querySelector('[aria-label="Radio stations"]')?.textContent ?? '';
    assert(row().includes('Experimental'), 'Show categories were lost');
    assert(row().includes('Afternoon selections') && !row().includes('Ambient'), 'Next programme line missing, or it took the current categories');
    await audit.go('/radio?genre=Talk');
    assert(document.querySelector('[aria-label="Radio stations"]'), 'Station tag filter lost the station');
    await audit.go('/radio?filter=Alex');
    assert(document.querySelector('[aria-label="Radio stations"]'), 'Host search lost the station');
    await audit.go('/radio?genre=Experimental');
    assert(document.querySelector('[aria-label="Radio stations"]'), 'Category filter lost the station');
    await audit.go('/radio?genre=Community%20network');
    assert(!document.querySelector('[aria-label="Radio stations"]'), 'Playlist group was inferred as a genre');
    for (const query of ['Alex', 'Talk', 'Experimental', 'Early Bird']) {
      await audit.go('/search?kind=radio&source=avoid%20radio&q=' + encodeURIComponent(query));
      assert(document.querySelector('[data-hit-id="avoid radio:audit-radio"]'), `Global search hid the radio match for ${query}`);
      assert(!overflow(), 'Search overflow');
    }
    await audit.go('/item?kind=radio&id=audit-radio');
    assert(document.querySelector('h1')?.textContent === 'Early Bird', 'Guide title did not reach Details');
    assert(document.querySelector('[aria-label="Next programme"]')?.textContent?.includes('Afternoon selections'), 'Next programme missing');
    assert(!document.querySelector('[aria-label="Next programme"]')?.textContent?.includes('Jazz'), 'Current genres leaked into Next');
    assert(document.body.textContent?.includes('min left'), 'Guide window has no remaining time');
    assert(document.querySelector('[data-detail-header] .detail-meta')?.textContent?.includes('NTS Radio, Community, Talk'), 'Station tags were lost');
    assert(!overflow(), 'Details overflow');
    await audit.go('/now', {player:'playing',live:true});
    // Now playing opens calm; Info shows the show's metadata in place.
    const copy = () => document.querySelector<HTMLElement>('[data-player-audio-copy]')?.innerText ?? '';
    const info = () => document.querySelector<HTMLButtonElement>('[data-player-top] button[aria-label="Info"]')!;
    assert(!copy().includes('Experimental') && !copy().includes('Afternoon selections'), 'Player did not open calm');
    if (info().getAttribute('aria-expanded') !== 'true') info().click();
    await settle();
    assert(copy().includes('Experimental'), 'Player Info lost categories');
    assert(document.querySelector<HTMLElement>('[aria-label="Next programme"]')?.checkVisibility(), 'Player Info lost Next');
    assert(copy().includes('Community, Talk'), 'Player Info lost station tags');
    assert(!overflow(), 'Player overflows');
    await audit.go('/item?kind=radio&id=audit-radio');
    const key = radioProgrammesQuery({origin:location.origin,token:'visual-fixture'}).queryKey;
    audit.client.setQueryData(key, { 'audit-radio': { programmes: [], live: { title:'Expired show',expiresAt:Date.now()-1 } } });
    await settle();
    assert(document.querySelector('h1')?.textContent === 'NTS Radio', 'Expired metadata remained in Details');
    await audit.go('/now', {player:'playing',live:true});
    const boundary = Date.now() + 1100;
    const current = { id:'boundary',title:'Boundary show',start:Date.now()-1000,end:boundary,categories:['Jazz'] };
    audit.client.setQueryData(key, { 'audit-radio': { programmes:[current,{id:'new',title:'New transmission',start:boundary,end:boundary+60000,categories:['Ambient']}],live:null } });
    await audit.updateSession(gate => ({...gate,state:{...gate.state!,radioProgramme:{...current,playbackId:'p',stationId:'audit-radio',provider:'xmltv',sampledAt:Date.now(),expiresAt:boundary}}}));
    assert(navigator.mediaSession.metadata?.title === 'Boundary show', 'Media Session lost the current show');
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert(document.querySelector('h1')?.textContent === 'New transmission', 'Player missed a broadcast boundary');
    assert(navigator.mediaSession.metadata?.title === 'New transmission', 'Media Session missed a broadcast boundary');
    // Calm or in Info, nothing of the previous show survives, including in the hidden part.
    assert(!document.querySelector('[data-player-audio-copy]')?.textContent?.includes('Jazz'), 'Previous categories survived the boundary');
    if (info().getAttribute('aria-expanded') !== 'true') info().click();
    await settle();
    assert(copy().includes('Ambient') && !copy().includes('Jazz'), 'Player Info kept the previous show after the boundary');
    const result = {passed:true,viewport:[innerWidth,innerHeight],checks:['host search','global metadata search','genre filter','station tag filter','station tags','group exclusion','current and next metadata','broadcast progress','player calm and Info','expiry','Media Session boundary','Info boundary','overflow']};
    if (!keepMounted) audit.close();
    return keepMounted ? {...result,audit} : result;
  } catch (error) {audit.close();throw error;}
}

export async function runLiveRadioMetadataRegression() {
  const audit = await mountUiAudit();
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 200));
  const key = radioProgrammesQuery({origin:location.origin,token:'visual-fixture'}).queryKey;
  try {
    await audit.go('/radio');
    const liveArtwork = 'https://i.ytimg.com/vi/ferZnZ0_rSM/hqdefault.jpg';
    const guide: RadioGuide = { programmes: [{ id:'rotation',title:'Rotation',start:Date.now()-3600000,end:Date.now()+3600000,categories:['Talk'],description:'Schedule slot synopsis' }],live:{stationId:'audit-radio',provider:'radio.avoid.quest',title:'Live session',artist:'Live host',genre:'Experimental',artworkUrl:liveArtwork,description:'Live episode synopsis',sampledAt:Date.now()-1000,expiresAt:Date.now()+60000} };
    audit.client.setQueryData(key, { 'audit-radio': guide });
    await settle();
    assert(document.querySelector('[aria-label="Radio stations"]')?.textContent?.includes('Live session'), 'Broad guide slot hid the live title in browsing');
    await audit.go('/search?kind=radio&source=avoid%20radio&q=Live%20host');
    assert(document.querySelector('[data-hit-id="avoid radio:audit-radio"]')?.textContent?.includes('Live session'), 'Search lost the live title or host');
    await audit.go('/item?kind=radio&id=audit-radio');
    assert(document.querySelector('h1')?.textContent === 'Live session', 'Details hid the live title');
    assert(!document.body.textContent?.includes('min left'), 'Details assigned the slot window to the live show');
    await audit.go('/now', {player:'playing',live:true});
    const current = radioNow(guide, 'audit-radio')!;
    await audit.updateSession(gate => ({...gate,state:{...gate.state!,radioProgramme:{...current,playbackId:'p'}}}));
    assert(document.querySelector('h1')?.textContent === 'Live session', 'Core metadata hid the live title in the player');
    assert(navigator.mediaSession.metadata?.title === 'Live session', 'Media Session hid the live title');
    assert(navigator.mediaSession.metadata?.artwork[0]?.src === liveArtwork, 'Media Session lost live artwork');
    document.querySelector<HTMLButtonElement>('[data-player-top] button[aria-label="Info"]')!.click();
    await settle();
    const copy = () => document.querySelector<HTMLElement>('[data-player-audio-copy]')?.innerText ?? '';
    assert(copy().includes('Live episode synopsis') && copy().includes('Experimental'), 'Info lost live metadata');
    assert(!copy().includes('Schedule slot synopsis') && !copy().includes('min left'), 'Info mixed slot metadata or times into the live show');
    await audit.go('/', {player:'playing',live:true});
    assert(document.querySelector('[data-home-hero] h2')?.textContent === 'Live session', 'Home hid the live title');
    // Both Core's event and browsing's guide must retire the live unit together.
    await audit.go('/now', {player:'playing',live:true});
    const expiry = Date.now() + 600;
    const expiring = {...guide,live:{...guide.live!,expiresAt:expiry}};
    audit.client.setQueryData(key, { 'audit-radio': expiring });
    await audit.updateSession(gate => ({...gate,state:{...gate.state!,radioProgramme:{...radioNow(expiring,'audit-radio')!,playbackId:'p'}}}));
    await new Promise(resolve => setTimeout(resolve, 800));
    assert(document.querySelector('h1')?.textContent === 'Rotation', 'Player kept expired live metadata');
    assert(navigator.mediaSession.metadata?.title === 'Rotation', 'Media Session kept expired live metadata');
    return {passed:true,viewport:[innerWidth,innerHeight],checks:['live title in browsing and search','Details','Core player metadata','live artwork and Media Session','Info without unrelated slot fields or times','Home','expiry fallback']};
  } finally { audit.close(); }
}
