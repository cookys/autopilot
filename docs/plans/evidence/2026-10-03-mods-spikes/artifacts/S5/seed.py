import json
real=json.load(open('/home/cookys/.claude.json'))
p='/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/claude-config/.claude.json'
d=json.load(open(p))
d.update({'hasCompletedOnboarding':True,'theme':'dark','lastOnboardingVersion':real.get('lastOnboardingVersion')})
if 'oauthAccount' in real: d['oauthAccount']=real['oauthAccount']
d.setdefault('projects',{})['/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/proj']={'hasTrustDialogAccepted':True,'hasCompletedProjectOnboarding':True,'allowedTools':[]}
json.dump(d,open(p,'w'),indent=1)
print(sorted(d.keys()))
