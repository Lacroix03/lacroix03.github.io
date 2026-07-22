---
title: "Differential Cryptanalysis of the Full 16-Round DES"
published: 2026-07-23
description: "Notes on Biham and Shamir's differential attack against full 16-round DES"
tags: ["Cryptography", "DES", "Differential Cryptanalysis"]
category: "Cryptography"
lang: "en"
urlSlug: "differential-cryptanalysis-des"
translationKey: "differential-cryptanalysis-des"
---

# Differential Cryptanalysis of the Full 16-Round DES

- Publication year: 1991
- Type: Cryptography, differential attack
- Authors: Eli Biham, Adi Shamir
- File and media: [Differential_Cryptanalysis_of_the_full_16-round_DES.pdf](/posts/differential-cryptanalysis-des/Differential_Cryptanalysis_of_the_full_16-round_DES.pdf)

# Introduction

Differential cryptanalysis is a powerful technique for attacking block ciphers. DES was designed to be as resistant to this kind of attack as possible, and its **S-boxes** were carefully tuned from the design stage to resist differential analysis. Because of that, the ciphertext after all 16 rounds was long considered close to an “impregnable” area where small input differences would be fully randomized and no statistically meaningful signal could be found.

However, Biham and Shamir broke this assumption by combining two structural properties of DES: its **Feistel network** and an **iterative differential characteristic**.

Their breakthrough can be summarized as follows.

- **Preserving probability:** Adding more rounds normally decreases the attack probability exponentially, but the authors minimized this loss by using an iterative characteristic where a certain difference returns to itself.
- **Structured data collection:** Instead of collecting plaintext pairs blindly, they proposed a clever data collection method called a **metastructure**, which makes it possible to filter the first-round and last-round output differences effectively.
- **Avoiding large memory requirements:** Earlier differential attacks required huge counter arrays, but this method verifies key candidates immediately, making the attack possible in a more realistic memory setting.

As a result, the paper showed that if **$2^{47}$ chosen plaintexts** are available, the secret key of full 16-round DES can be recovered with about **$2^{37}$ operations**. This shook confidence in the security of the standard cipher at the time and also helped define the security-evaluation standard that later block ciphers would be expected to pass.

# Paper Overview

## Background and limits of previous work

DES had been analyzed widely for more than 15 years after its introduction in the mid-1970s, but no attack faster than exhaustive search($2^{55}$) was known.

- **Chaum and Evertse’s attack:** It attacked 6-round DES with complexity $2^{54}$, but it did not extend to 8 rounds or more.
- **Davies’ attack:** It proposed a method for analyzing 8-round DES, but applying it to the full 16-round cipher required more data than the full plaintext space($2^{64}$), making it impractical.

Among these approaches, differential cryptanalysis was the most effective.

![DES differential characteristic](/posts/differential-cryptanalysis-des/image.png)

The differential attack on DES is based on the two-round iterative characteristic shown above.

![Iterative characteristic](/posts/differential-cryptanalysis-des/image-1.png)

The earlier differential attack applied this iterative characteristic from round 1 through round 13, for 6.5 repetitions, and then recovered the key in rounds 14 and 15 using a 2R-attack.

That attack tries many plaintext pairs and removes obviously wrong pairs by observing known input and output values. Correct pairs always suggest the correct value for the relevant key bits, while wrong pairs suggest random values. After enough pairs have been analyzed, the correct value becomes the most frequently suggested one.

In practice, the algorithm stores the number of times each value is suggested in a counter array. The index with the largest counter, meaning the most frequently suggested value, is output as the key value.

### Limits of the previous differential attack

- The approach was effective up to 15 rounds($2^{-47.2}$), but attacking all 16 rounds required complexity $2^{58}$, which was slower than exhaustive search.
- It required a huge amount of memory, up to $2^{42}$ counters.
- If the number of analyzed pairs was below the required threshold, the success probability was very low.

## Main contributions of the paper

> The paper achieved the first result that broke the “16-round barrier.”

1. It showed that full 16-round DES can be attacked with **$2^{37}$ time complexity** and **$2^{36}$ ciphertext analyses**.
2. Unlike earlier attacks that required huge counter arrays, it introduced a nearly **memoryless** method.
3. It showed that the attack can be parallelized and executed simultaneously on many independent processors.

Earlier methods identified key candidates through statistical analysis after collecting many right pairs. In contrast, this paper guarantees that once the first right pair is found, the correct key can be discovered immediately.

## Main idea

The key strategy is not simply to add one more round to the 15-round attack. Instead, the paper uses the structure of DES in a more innovative way.

![Main idea](/posts/differential-cryptanalysis-des/image-2.png)

### Key idea 1. Using structured data for the first round

The biggest weakness of differential cryptanalysis is that the probability decreases exponentially as the number of rounds increases. The paper handles this by avoiding probability in the first round.

![First round structure](/posts/differential-cryptanalysis-des/image-3.png)

To obtain the desired difference at the input of round 2 after round 1, the output difference from the round-1 S-boxes must be canceled by xoring it with the left four bytes of the plaintext.

For this, all possible output-difference candidates from the round-1 S-boxes S1 through S3 are precomputed. There are $2^{12}=4096$ such candidates, and one of them must be the real output difference produced under the real key $K_1$.

![Plaintext groups](/posts/differential-cryptanalysis-des/image-4.png)

The plaintext pairs are then constructed as follows.

1. Group $P_i$
   1. Right side($R_P$): fixed to the same value $R$
   2. Left side($L_P$): $2^{12}$ different values
2. Group $Q_i$
   1. Right side($R_Q$): fixed to $R_P$ xor `19 60 00 00`
   2. Left side($L_Q$): $2^{12}$ different values

By taking one value from P and one value from Q, we get $2^{12} \times 2^{12}=2^{24}$ combinations.

No matter which P and Q are chosen, the right-side difference of the pair is `19 60 00 00`. The left-side difference becomes one of the candidate output differences. One of those candidates matches the real output difference exactly, so the right-side difference at the input of round 2 becomes 0. Therefore, among the $2^{24}$ combinations, $2^{12}$ valid pairs can be obtained.

Then, from rounds 2 through 14, the attack uses the property that a certain difference returns to itself every two rounds. As described earlier, this repeats 6.5 times with probability 1/234 per repetition, giving an overall probability of $2^{-47.2}$.

### Key idea 2. S-box output filtering

![S-box filtering](/posts/differential-cryptanalysis-des/image-5.png)

By analyzing S-box input and output differences in rounds 15 and 16, the attack checks cases where the output difference of S-boxes such as **S4 through S8** is 0. This removes more than 99.9% of wrong key candidates very quickly. On average, only 1.19 pairs survive.

The attack then performs key guessing with this very small number of remaining candidates.

### Additional point: key guessing

![Key guessing](/posts/differential-cryptanalysis-des/image-6.png)

Because of the DES key schedule, the same key bits are reused in different rounds. This is a critical weakness. The numbers in the figure show how many key bits overlap between the S-boxes in round 1 and round 16.

The DES key schedule is shown below.

![DES key schedule](/posts/differential-cryptanalysis-des/image-7.png)

The reason to compare round 1 and round 16 is that they are close in the key schedule. As rounds progress, the key register rotates. Bits used in round 1 return near their original positions by round 16 or are placed according to predictable rules.

Therefore, by looking at the DES design, we can determine which of the 56 secret-key bits enters which S-box in which round.

For example, suppose we guess the 6 key bits of S4 in round 16, and 3 of those bits are the same as the bits used by S3 in round 1. Then we do not need to search all 6 bits($2^6=64$) to find the S3 key. We can fix the 3 already known bits and search only the remaining 3 bits($2^3=8$). By using these shared bits as bridges between round 1 and round 16, the full 56-bit key can be filled in faster than by exhaustive search.

After this algorithm, the 56-bit key space is reduced to about 16 candidates. Each candidate is tested by encrypting plaintext and checking which key produces the exact ciphertext.

The reason trial encryption is possible here, while the earlier 15-round attack depended on statistics, is the strength of the filtering. The 15-round attack had weaker filtering conditions, so many candidates remained and a statistical counter method was needed. In contrast, this paper uses a carefully designed structure and strong pre-filtering to remove more than 99.9% of false candidates. As a result, **only a very small number of candidates remain, and direct trial encryption is efficient enough**.

# Conclusion

Using the attack introduced in this paper, the key can be recovered within $2^{37}$ complexity using $2^{47}$ chosen plaintexts.

$2^{47}=1.40737488 \times 10^{14}$ is about 140 trillion. Since one DES plaintext block is 8 bytes, this is about **1.1 petabytes** of data. With early-1990s network speeds, transferring that much data would have taken hundreds of years, so the attack was not practical at the time. With modern network speeds, it could take from minutes to days depending on the environment.

Also, differential cryptanalysis requires chosen plaintexts to be submitted to the target system. It cannot be performed merely by intercepting packets in the middle.

Even though the attack seems practically infeasible, the significance of the paper is clear.

1. It was the first method to break 16-round DES faster than exhaustive search.
2. It established a design standard: a cipher that is theoretically vulnerable to differential cryptanalysis cannot become a reliable standard.

My personal takeaways from reading the paper are as follows.

- Because the paper discusses an attack on a cryptographic system, I spent more time studying the target cipher and the background of differential cryptanalysis itself. The more I study these foundations, the easier and more enjoyable reading papers like this will become.
- It is helpful to decide on a reading strategy before reading.
  - The parts to focus on depend on the goal of reading the paper.
  - It is useful to read the abstract carefully to understand the overall flow, then read the introduction to understand the limits of prior work and how this paper overcomes them. After that, the main body becomes easier to follow.
- Proper use of AI is useful.
  - I used it to check whether my understanding was correct and to summarize content.
  - Moonlight was useful.

> Reference
>
> - Heys, Howard M. *A Tutorial on Linear and Differential Cryptanalysis*. Electrical and Computer Engineering, Memorial University of Newfoundland, July 2015. PDF file. [www.ioactive.com](https://www.ioactive.com/wp-content/uploads/2015/07/ldc_tutorial.pdf)
> - blisstoner. *Understanding Differential Attacks*. Infossm Technical Blog, 8 Apr. 2019. [차분 공격의 이해](https://infossm.github.io/blog/2019/04/08/%EC%B0%A8%EB%B6%84-%EA%B3%B5%EA%B2%A9%EC%9D%98-%EC%9D%B4%ED%95%B4/)
> - RBTree. *Differential Cryptanalysis on 4-round DES*. RBTree.insert(), 16 July 2021. [Differential Cryptanalysis on 4-round DES](https://rbtree.blog/posts/2021-07-16-differential-cryptanalysis-on-des/)
> - wnrjsxo. *DES(Data Encryption Standard)*. Naver Blog. [DES(Data Encryption Standard)](https://m.blog.naver.com/wnrjsxo/221708511553)
