---
title: "Comparing Fediverse software for hosting: Ease of use, efficiency, waste"
date: 2023-12-18T05:17:00+02:00
url: "/2023/12/18/comparing-fediverse-software-for-hosting.html"
tags: [ "Research" ]
syndication:
  mastodon: https://social.tchncs.de/@stefanlaser/111599017368456228
  bluesky: https://bsky.app/profile/stefanlaser.bsky.social/post/3kgrxhm4vb22x
---

Here's a blog post on #hosting a microblogging instance on the #Fediverse with ecological concerns in mind. It's a longer one. And unfinished, since it's messy tinkering in progress, not least due to my #Vietnam routing. 👇

Following [our Mastodon article](https://www.easst.net/article/the-environmental-footprint-of-social-media-hosting-tinkering-with-mastodon/), I am exploring options to host a Fediverse instance with a Raspberry Pi and solar power, testing limits. The goal is to host one or multiple bots and report on data. Users later. Perhaps this could also be an offer for others to host bots. On another level, this is an effort to compare different fediverse setups and their Ease of use, efficiency, and waste. Other users have already created helpful reports that I can built on, see e.g. [Deploying a piece of the Fediverse (dragas.net)](https://it-notes.dragas.net/2023/01/15/deploying-a-piece-of-the-fediverse/)

It boils down to choosing the software. As a start, I have asked people on Mastodon and Lemmy for tips on what software to use. 

# Moving beyond Mastodon: The heavy elephant
Users reported Mastodon is resource-heavy, and media caching is an issue, because it caches all media by default without any options to delete. It is not a light system; quite the contrary. Admins, it seems, need experience to manage the potential overload, regardless of their instance's size. At the same time, it lacks features like rich Markdown and Quote Tweets. Install seems to work, but many users report it took multiple hours.

> I never used Mastodon because my servers would never handle it. I started with Friendica, moved to pleroma, and ended up ultimately with rebased (and obviously lemmy and lotide and peertube)

As a follow-up, that user reported:
> My first server had an outdated CPU, very little memory and a spinning hard drive, so that turned out to be a huge limitation for a lot of software. I needed stuff that hardly used any memory and also didn't have a lot of extra services running at once. When I started adding some services, lots of stuff started grinding to a halt.

> On linux, the glances application is really useful. Besides just showing you what programs are using memory and CPU time, it also shows IOWait times and throughput so if you're being bottlenecked by something or other it's a lot easier to see.

> There's also a service called tuned that does some automatic tuning, and if you're using postgres databases, there's another tool called pg_repack that'll pack your database while running. It maxes out your CPU and uses a lot of disk while running, but if you don't do something routinely then your postgresql database slowly gets sloppier and it'll start using more and more resources until your server appears to be useless.

Misskey or Calckey (now: FireFish) are slightly lighter options and much feature richer, but too heavy for a single instance. This is more of a personal project.

Three options appear appropriate. Two of them were suggested in my original online post:

# Original post on Mastodon and Lemmy asking for help
> I'm looking for a customisable, resource-efficient Mastodon fork. Bonfire? Rebased? Or go non-Ruby, like Pleroma (nah), Misskey Calckey, indeed, Lemmy (hui)? Any experiences?

This is part of an endeavour to host w/ a RaspberryPi & solar power. It will be a device to mess around, test, and share experiences.

Potential features:

- tweaking network traffic in various ways
- media options: off, auto compression, auto delete
- monitoring server metrics, energy flow, sharing data through a bot
- auto-off when battery low, sad emoji

I am re-posting this from Mastodon w/ minor edits because of the Fediverse and potential cross-interaction. I probably should have posted here first and then shared the link on Mastodon, but it's a Mastodon question, so I did it the other way around. Still not sure what's the best way to do this, though.

# Preface: static IP on the Pi
The Pi needs a static IP. Since the machine will be close to the solar battery system, I need a wifi option, as described here:
[Set up a static IP-address | The Raspberry Pi Guide (raspberrypi-guide.github.io)](https://raspberrypi-guide.github.io/networking/set-up-static-ip-address)

And, to make it open to the web: 
Open up your router's admin page and find a section titled either **Port Forwarding**, **Port Mapping**, or **Port Management**, then create two new entries.

The first is for **HTTP** (insecure) traffic. Set both the local and public port to **80**, and the local IP address to the IP address of your Raspberry Pi.

The second is for **HTTPS** (secure) traffic. Set both the local and public port to **443**, while keeping the local IP address to the IP address of your Raspberry Pi.
# Potential platforms
## GoToSocial
> it's still in alpha, but if it's just for messing around maybe try [GoToSocial](https://gotosocial.org/)!

>I think you'd have a much better time with something lighter than Mastodon if it's running on a limited system. If you are really looking to minimise requirements, Pleroma and its derivatives are unfortunately about the best for it afaik, though I certainly have plenty of misgivings. I'm personally partial to GoToSocial, and it'd be my go-to recommendation for any self-host atm unless they had specific requirements that made it unsuitable.

GoToSocial is the most-like Mastodon option, seeking connections with many Mastodon frontend apps, although with different features and a lighter backend. Crucially, it is built using Golang, a speedy language. This is how they pitch their project: "GoToSocial provides a lightweight, customisable, and safety-focused entryway into the [Fediverse](https://en.wikipedia.org/wiki/Fediverse), and is comparable to (but distinct from) existing projects such as [Mastodon](https://joinmastodon.org/), [Pleroma](https://pleroma.social/), [Friendica](https://friendica.net/), and [PixelFed](https://pixelfed.org/)."

The docs offer a docker image, and it seems doable. [Container - GoToSocial Documentation](https://docs.gotosocial.org/en/latest/getting_started/installation/container/) 

## Akkoma
>I quite like the Akkoma fork of Pleroma.

Pleroma has a few development lags and seems to host many right-wing servers (similar to the fork Rebased), so the Akkoma fork is highly welcome. It also has more features. This is why, as one dev emphasises, Akkoma is recommended by key members of the AcitivityPub working group.

These are the docs. [AkkomaGang/akkoma: Magically expressive social media - akkoma - Akkoma Development](https://akkoma.dev/AkkomaGang/akkoma/)

But, magically, there is an explanation on how to install this on a Pi. [www.makeuseof.com/raspberry...](https://www.makeuseof.com/raspberry-pi-deploy-akkoma-fediverse-server/)

## Honk
>If you only want a single-user instance you can go with [honk](https://humungus.tedunangst.com/r/honk).

> Right now I host it on my rpi3 under a vlan connection (1000kbps/125kbps). No struggle, 120mb in ram for an uptime of 80 days. Following nearly 40 accounts on 15 instances.

honk sounds like a joke, and it is funny to a certain degree. As explained in their docs, it is a ridiculously simple setup: "Take control of your honks and join the federation. An ActivityPub server with minimal setup and support costs. Spend more time using the software and less time operating it." This sounds great.

The docs are from another world. [Joining the Fediverse with honk - Suffix](https://www.suffix.be/blog/joining-fediverse-honk/)

# Comparing the three options 
The conclusion is as follows: Start with Akkoma and see how it works; perhaps install GoToSocial and honk afterwards. It could be interesting to move forward with a maximum contrast, as in: Akkoma, honk, GoToSocial.

This is my qualitative assessment based on the information above.

| Assessment  | GoToSocial | *Akkoma* | honk | Mastodon |
|----------|------------|--------|------|----------|
| **Light**    | +          | ++     | +++  | -        |
| **Features** | +++        | ++     | +    | ++       |
| **Docs**     | ++         | +++    | +    | +++      |
| **Interop**  | ++         | ++     | +    | ++       |
| **Install**  | ++         | +++    | ++   | +        |
| **Sum**  | 10         | 12    | 8   | 7        |

# Prior and next steps
The above assessment is from the 19th of July. Before this, I explored and expanded the hardware setup. We started setting up the software in Bochum, but many things happened. And the university's network infrastructure is not made for static IPs, especially in our building. And then folks were busy. It took way too long to publish this, and research in Vietnam lay in between. We started with a solar Panel made for a Pi. But it does not produce enough power. So a proper 100w solar panel feeding a mobile battery is the solution. That's at least what I thought it was.

So the next steps:
- Setting up the Pi with a static Wifi IP
- Installing Akkoma (with the most efficient solution, perhaps Docker, however that works)
- Document the process
- Using the solar-power of lovely Vietnam in front ouf our appartment
 
I already completed this process, almost. More research is to, as I've shown with my failure with a battery system, published in our collaborative research centre's [Virtual Object of the Month series](https://www.virtuelle-lebenswelten.de/blog-post/virtuelles-objekt-des-monats-energy-stack).

#Mastodon #solarpunk

![](/uploads/2023/fedi-tinkering.jpg)
