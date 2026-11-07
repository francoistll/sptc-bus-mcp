# Phrases de touristes : python3 web/tests/tourist.py [URL du site]  (affiche l'interprétation de chaque question ; vérifier à l'œil)
import json, time, urllib.request, sys
Q = [
 "How do I get from Victoria to Beau Vallon?",
 "next bus to Beau Vallon beach",
 "what time is the last bus from Beau Vallon to Victoria",
 "bus from the airport to Victoria",
 "I want to go to Anse Royale from Victoria tomorrow morning",
 "Is there a bus to Anse Lazio?",
 "bus to Baie Lazare",
 "how long does the bus take from Victoria to Anse Royale",
 "first bus from Victoria to Beau Vallon",
 "bus from Mont Fleuri to Victoria on sunday",
 "timetable route 20",
 "Which bus goes to Takamaka?",
 "Comment aller de Victoria à Anse Royale en bus ?",
 "quel est le premier bus de Victoria à Beau Vallon samedi",
 "bus pour la plage de Beau Vallon",
 "dernier bus pour Victoria depuis Beau Vallon",
 "à quelle heure passe le bus 22 ?",
 "je suis à Anse Etoile, prochain bus pour Victoria",
 "bus de Victoria à Port Glaud après 15h",
 "Bus from Victoria to Anse Boileau at 5pm",
 "horaires bus Victoria Beau Vallon",
 "bus stops near Glacis",
 "where is the bus stop for Cascade",
 "bus Victoria to Au Cap this evening",
 "Beau Vallon to Victoria around 8:30 am weekday",
 "cheapest way to Praslin",
 "what's the weather today",
 "route 2B saturday",
 "prochain bus de Victoria à Anse aux Pins",
 "bus from Victoria to Grand Anse",
]
for q in Q:
    req = urllib.request.Request('' + (sys.argv[1] if len(sys.argv)>1 else 'https://bus-seychelles.pages.dev') + '/api/ask', data=json.dumps({'q': q}).encode(), headers={'content-type':'application/json','user-agent':'curl/8.7.1'})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=30))
        p = d['parsed']
        n = len(d.get('rows') or d.get('tables') or d.get('stops') or d.get('routes') or [])
        print(f"{d['via']:5} {d['intent']:7} n={n:<2} {str(p['depart']):16}→{str(p['arrivee']):16} t={p['time']} d={d['day'][-3:]} {'LAST ' if d['last'] else ''}{'FIRST ' if d.get('first') else ''}{'TMRW ' if d.get('tomorrow') else ''}{d.get('reason') or ''} {(d.get('why') or '')[:40]} | {q}")
    except Exception as e:
        print('ERR', e, '|', q)
    time.sleep(5)
