// App-owned equipment diagrams. Generate offline SVG assets and their bundled XML registry.
const fs = require('node:fs');
const data = require('../src/equipment/catalogue.json');
const line=(x1,y1,x2,y2,c='#9AAEBB',w=4)=>`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
const path=(d,c='#9AAEBB',w=4,fill='none')=>`<path d="${d}" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" fill="${fill}"/>`;
const rect=(x,y,w,h,c='#384A58')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}" stroke="#9AAEBB" stroke-width="2"/>`;
const circle=(x,y,r,c='#384A58')=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#9AAEBB" stroke-width="3"/>`;
const orange='#FF9C35';
const frame=()=>path('M23 108V15H94V108M12 109H105')+rect(80,43,9,48)+[52,62,72,82].map(y=>line(81,y,88,y,'#758B99',1)).join('');
const seat=()=>rect(39,76,37,7,orange)+line(51,84,51,107)+rect(35,40,8,34,orange);
const dumbbell=()=>line(35,62,85,62,orange,8)+rect(19,43,18,38)+rect(83,43,18,38)+line(12,52,12,72)+line(108,52,108,72);
const bench=(angle=0)=>`<g transform="rotate(${angle} 60 65)">${rect(18,57,84,11,orange)}${line(34,70,27,102)}${line(85,70,94,102)}</g>`+line(18,106,39,106)+line(85,106,106,106);
const shapes={
 kettle:()=>path('M43 50V34A17 17 0 0 1 77 34V50',orange,6)+path('M37 49Q23 75 29 94Q60 109 91 94Q97 75 83 49Z','#9AAEBB',3,'#384A58')+path('M45 67Q39 77 42 87','#718897',3),
 dumbbell,
 round_dumbbell:()=>line(35,62,85,62,orange,8)+circle(27,62,20)+circle(93,62,20)+circle(27,62,7,'#101B23')+circle(93,62,7,'#101B23'),
 hex_dumbbell:()=>line(35,62,85,62,orange,8)+path('M12 49L27 40L42 49V75L27 84L12 75Z','#9AAEBB',3,'#384A58')+path('M78 49L93 40L108 49V75L93 84L78 75Z','#9AAEBB',3,'#384A58'),
 adjustable_dumbbell:()=>dumbbell()+[22,28,90,96].map(x=>line(x,43,x,81,'#101B23',2)).join('')+path('M14 88H107',orange,4),
 selector_dumbbell:()=>dumbbell()+rect(9,84,102,10)+circle(27,62,9,orange)+circle(93,62,9,orange),
 loadable_dumbbell:()=>line(7,62,113,62,orange,5)+[18,30,81,93].map(x=>rect(x,40,8,44)).join(''),
 competition_kettle:()=>path('M43 45V27H77V45',orange,6)+circle(60,74,31,orange)+line(42,103,78,103,'#9AAEBB',3),
 adjustable_kettle:()=>path('M43 45V27H77V45',orange,6)+circle(60,75,32)+path('M30 65H90M29 78H91M35 91H85',orange,3)+circle(60,55,6,orange),
 barbell:()=>line(7,63,113,63,orange,5)+rect(22,35,14,55)+rect(84,35,14,55)+rect(13,45,7,35)+rect(100,45,7,35),
 ez:()=>path('M8 63H35L45 51L60 71L75 51L85 63H112',orange,5)+rect(17,42,12,42)+rect(91,42,12,42),
 trap:()=>path('M10 60H30L43 37H78L92 60L78 83H43L30 60M48 50V70M73 50V70',orange,4)+rect(11,39,12,43)+rect(98,39,12,43),
 plates:()=>circle(49,65,34)+circle(49,65,9,'#101B23')+circle(83,73,27)+circle(83,73,7,'#101B23')+path('M30 48L36 42M79 54L87 55',orange,5),
 bench:()=>bench(),incline:()=>path('M25 86L48 47L83 72',orange,13)+line(36,75,25,106)+line(79,74,96,106)+line(18,108,39,108)+line(87,108,105,108),decline:()=>bench(15),
 rack:()=>path('M22 108V16H97V108M13 108H33M86 108H109M22 20H97M22 55H45M75 55H97')+line(22,64,97,64,orange,5)+line(32,55,32,85,'#7E94A4',2)+line(87,55,87,85,'#7E94A4',2),
 squat_rack:()=>path('M25 108V30H96V108M16 108H34M86 108H105M25 37H96')+line(15,58,106,58,orange,5),
 stands:()=>path('M31 25V107M88 25V107M18 108H45M75 108H102M31 43H41M78 43H88')+line(13,48,107,48,orange,5),
 gym:()=>frame()+seat()+path('M29 24L50 38M89 24L69 38M50 38V56M69 38V56',orange,5),
 press:()=>frame()+seat()+path('M28 36L48 49M91 36L70 49M48 49V65M70 49V65',orange,6),
 pulldown:()=>frame()+seat()+path('M60 16V41M34 43H87M34 43L26 52M87 43L96 52',orange,5),
 row:()=>frame()+path('M28 105H65M41 102V78M26 75H65M72 75V101')+path('M83 94L51 67M44 66H60',orange,4),
 extension:()=>frame()+seat()+path('M75 81L76 101M65 100H89',orange,9),
 curl:()=>frame()+path('M21 60H81M37 62V106M72 63V107')+path('M78 66L101 80M93 87L107 76',orange,9),
 fly:()=>frame()+seat()+path('M25 42V69M95 42V69M25 42L46 29M95 42L74 29',orange,8),
 overhead:()=>frame()+seat()+path('M28 41L43 24M92 41L77 24M43 24V15M77 24V15',orange,7),
 ab:()=>frame()+seat()+path('M60 25V57M47 46L72 56',orange,8),
 dip:()=>path('M26 108V39H47M94 108V39H72M15 108H39M82 108H106')+path('M27 39L49 55M93 39L71 55',orange,6),
 cable:()=>frame()+path('M46 18V98M43 48H67M59 47V61',orange,3)+circle(47,18,6)+circle(47,97,6),
 dual_cable:()=>path('M15 110V17H105V110M5 110H27M93 110H116')+rect(20,43,10,57)+rect(91,43,10,57)+path('M22 22L46 64M99 22L75 64M43 64H50M72 64H79',orange,3),
 crossover:()=>path('M13 109V12H107V109M4 110H24M96 110H118')+rect(19,45,10,55)+rect(91,45,10,55)+path('M20 20L49 74M100 20L72 74M46 74H53M69 74H76',orange,3),
 leg_press:()=>path('M19 109L110 22M28 109L115 32')+path('M18 72L45 96L65 83',orange,11)+line(67,64,88,84,orange,11)+line(39,96,27,110)+line(87,41,100,54,'#9AAEBB',8),
 calf:()=>frame()+seat()+path('M30 57H73M70 57V87M60 94H83',orange,8),
 abductor:()=>frame()+seat()+path('M48 81L27 102M64 81L90 102',orange,9)+path('M19 96L31 107M85 107L98 94',orange,6),
 adductor:()=>frame()+seat()+path('M33 81L51 103M81 81L65 103',orange,9)+path('M47 95V108M68 95V108',orange,6),
 smith:()=>path('M19 108V13H101V108M9 109H111M30 17V104M90 17V104')+line(7,58,114,58,orange,6)+rect(13,43,12,30)+rect(96,43,12,30),
 assisted:()=>frame()+path('M26 25H46M72 25H96M46 25V18H72V25M43 82H76',orange,7)+rect(43,92,33,10),
 bike:()=>circle(34,86,21)+circle(91,87,19)+path('M34 85L62 52L91 86M59 54L70 84H35M60 53L57 43M48 42H67M88 72L83 32L99 24',orange,4)+line(66,83,80,96)+line(76,96,88,96),
 bicycle:()=>circle(28,86,25)+circle(95,86,25)+path('M28 86L49 47L73 86H28M49 47H83L95 86M79 46L85 27L99 25M49 47L44 35M34 33H54',orange,4),
 treadmill:()=>path('M12 91H108L95 108H7Z','#9AAEBB',3,'#384A58')+path('M90 87V29L68 16H47M87 48H61',orange,5)+rect(55,13,29,16),
 rower:()=>circle(22,80,22)+path('M39 88H112M65 83H82M68 85V98M52 96L61 63M58 64L88 42',orange,5)+line(4,109,116,109)+line(106,87,112,109),
 elliptical:()=>circle(38,86,23)+path('M26 96L88 103M38 85L70 48L84 19M59 96L77 59L101 34M70 49L61 21M76 61L66 36',orange,4)+line(12,111,111,111),
 stairs:()=>path('M19 106H45V88H65V70H86V52H105V106Z','#9AAEBB',3,'#384A58')+path('M21 78V47L91 16V47M95 19V51',orange,5),
 band:()=>path('M29 33Q8 59 29 85Q61 111 93 85Q114 60 93 33Q62 9 29 33Z',orange,9)+path('M31 37Q15 60 33 81Q61 103 90 81Q106 60 90 37','#FFC27F',2),
 tube:()=>path('M32 35Q12 84 42 94Q68 110 88 73L98 38',orange,4)+path('M22 23H43V38H22ZM88 23H109V38H88Z'),
 mini_band:()=>`<ellipse cx="46" cy="68" rx="31" ry="16" stroke="${orange}" stroke-width="10"/><ellipse cx="78" cy="45" rx="26" ry="14" stroke="#9AAEBB" stroke-width="9"/>`,
 ropes:()=>path('M13 35Q34 8 45 48T77 63T112 82M12 66Q35 39 47 79T79 94T113 105',orange,8)+path('M11 29V72','#9AAEBB',9),
 suspension:()=>path('M60 14L26 83M60 14L96 83',orange,5)+path('M15 83H38V100H15ZM84 83H108V100H84Z'),
 ball:()=>circle(60,65,39)+path('M23 65H97M60 27Q26 65 60 104M60 27Q94 65 60 104',orange,3),
 slam:()=>circle(60,66,40,'#293743')+path('M33 47Q62 28 88 47M28 81Q63 99 94 80','#526B7D',3),
 sandbag:()=>rect(17,47,88,51)+path('M38 48V32H54V48M71 48V32H87V48',orange,6)+line(32,72,90,72,'#6A8191',2),
 box:()=>path('M24 46L68 27L106 46V101L63 117L24 96Z','#9AAEBB',3,'#384A58')+path('M24 46L64 63L106 46M64 63V116',orange,3),
 sled:()=>path('M12 104H109M26 98V45M90 98V45M26 72H91M45 98V74M76 98V74',orange,6)+circle(62,85,17)+circle(62,85,5,'#101B23'),
 landmine:()=>path('M21 101L97 26',orange,7)+rect(87,13,17,36)+path('M9 110H41M24 100V110'),
 jump_rope:()=>path('M30 27Q-4 108 57 107Q121 107 91 27',orange,3)+line(28,17,37,39,'#9AAEBB',9)+line(91,17,83,39,'#9AAEBB',9),
 bag:()=>path('M43 8L50 28M77 8L70 28')+rect(36,27,49,76)+line(40,40,82,40,orange,5)+line(40,89,82,89,orange,5),
 standing_bag:()=>rect(39,15,43,70)+line(61,85,61,104)+path('M31 110Q61 92 91 110Z','#9AAEBB',3,'#384A58')+line(42,29,80,29,orange,5),
 speed_bag:()=>path('M16 23H105M96 23V110')+line(60,24,60,43)+path('M60 43Q32 70 60 89Q88 70 60 43Z',orange,3,'#384A58'),
 gloves:()=>path('M19 79L17 51Q15 24 41 24Q61 24 61 48L68 69L56 92L30 97Z','#9AAEBB',3,'#384A58')+path('M66 79L64 51Q62 24 87 24Q109 24 109 48L115 69L104 92L77 97Z','#9AAEBB',3,'#384A58')+line(26,86,56,81,orange,7)+line(73,85,104,81,orange,7),
 vr:()=>path('M30 45Q61 29 93 45V72Q62 90 30 72Z','#9AAEBB',3,'#384A58')+path('M31 47L21 35H100L94 47',orange,4)+circle(43,61,8,'#101B23')+circle(80,61,8,'#101B23')+path('M18 76Q2 65 9 93L21 108M104 77Q122 65 115 93L103 108',orange,5),
 pull_up:()=>path('M14 52V28H108V52M29 28V48M91 28V48',orange,6)+path('M14 29V13M108 29V13'),
 mat:()=>path('M14 68L81 29L110 54L43 96Z','#9AAEBB',3,'#384A58')+path('M25 73L90 36M34 81L99 45',orange,2)
};
function render() {
const art={};
for (const item of data.items) {
 if (!shapes[item.shape]) throw Error('No equipment illustration: '+item.id);
 const detail=`<path d="M16 115H108" stroke="#526474" stroke-width="1"/>`;
 const xml=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" role="img"><title>${item.name.replaceAll('&','&amp;')}</title><rect width="160" height="120" rx="10" fill="#111B23"/><g transform="translate(20 0)">${shapes[item.shape]()}${detail}</g></svg>`;
 art[item.id]=xml;
}
return art;
}
module.exports = { render };
if (require.main === module) {
 const art = render();
 for (const [id, xml] of Object.entries(art)) fs.writeFileSync('assets/equipment/'+id+'.svg',xml+'\n');
 fs.writeFileSync('src/equipment/artwork.generated.json',JSON.stringify(art,null,2)+'\n');
 console.log('Bundled '+Object.keys(art).length+' offline equipment illustrations');
}
